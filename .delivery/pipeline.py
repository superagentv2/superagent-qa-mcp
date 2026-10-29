#!/usr/bin/env python3
"""GitHub-side reference client. Uses the official OIDC action + AWS SDK + Podman."""
from datetime import datetime, timezone
import base64
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

from contract import require, validate


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def aws(config, *args):
    # AWS-specific registry adapter. The rest of delivery is ordinary SSH/OCI.
    import boto3
    client = boto3.client("ecr", region_name=config["region"])
    if args == ("ecr", "get-login-password"):
        account = config["registry"].split(".")[0]
        record = client.get_authorization_token(registryIds=[account])["authorizationData"][0]
        require(record["proxyEndpoint"] == "https://" + config["registry"], "wrong registry login")
        username, password = base64.b64decode(record["authorizationToken"]).decode().split(":", 1)
        require(username == "AWS", "registry login user")
        return password
    if args[:2] == ("ecr", "describe-images"):
        repository = args[args.index("--repository-name") + 1]
        tag = args[args.index("--image-ids") + 1].removeprefix("imageTag=")
        return client.describe_images(repositoryName=repository, imageIds=[{"imageTag": tag}])["imageDetails"][0]["imageDigest"]
    raise ValueError("Unsupported registry operation")


def check_basic_scan(config, repository, digest, client=None):
    """Fail before SSH if an OS scan is unavailable or contains critical findings."""
    import boto3
    from botocore.exceptions import ClientError
    client = client or boto3.client("ecr", region_name=config["region"])
    deadline = time.monotonic() + 240
    while True:
        try:
            result = client.describe_image_scan_findings(repositoryName=repository, imageId={"imageDigest": digest})
            status = result["imageScanStatus"]["status"]
        except ClientError as error:
            if error.response["Error"]["Code"] != "ScanNotFoundException":
                raise
            result, status = {}, "PENDING"
        if status == "COMPLETE":
            findings = result.get("imageScanFindings")
            require(isinstance(findings, dict), "OS scan result unavailable")
            completed = findings.get("imageScanCompletedAt")
            require(isinstance(completed, datetime) and (datetime.now(timezone.utc) - completed).total_seconds() <= 86400, "OS scan older than 24h; refresh scan before promotion")
            counts = findings.get("findingSeverityCounts", {})
            require(counts.get("CRITICAL", 0) == 0, "Critical OS image findings block deployment")
            return {"status": status, "severity_counts": counts}
        require(status in {"PENDING", "IN_PROGRESS"}, "OS image scan did not complete successfully")
        require(time.monotonic() < deadline, "OS image scan deadline exceeded; deployment held")
        time.sleep(5)


def identity(config, existing=False):
    sha, ref, repository = (os.environ[k] for k in ("GITHUB_SHA", "GITHUB_REF", "GITHUB_REPOSITORY"))
    require(set(config["allowed_sources"]) == {repository}, "multi-repository release needs the documented coordinator adapter")
    release = sha + "-" + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
    if existing and os.environ.get("DEPLOY_RELEASE_ID"):
        release = os.environ["DEPLOY_RELEASE_ID"]
        require(re.fullmatch(r"[0-9a-f]{40}-[0-9]{1,20}-[0-9]{1,6}", release), "existing release ID")
        sha = release.split("-")[0]
    return sha, ref, repository, release


def build(config):
    sha, ref, repository, release = identity(config)
    require(ref in config["allowed_sources"][repository], "release branch")
    # This directory is administrator-created once, with access only for isolated
    # build users. All enrolled runners on a host use the same lock inode.
    lock_path = os.environ.get("BUILD_LOCK_FILE", "/srv/ci/locks/image-build.lock")
    with open(lock_path, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        # Six persistent idle runners and current apps must leave host headroom.
        available = next(int(line.split()[1]) for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith("MemAvailable:"))
        require(available >= 4 * 1024 * 1024, "Less than 4GiB host RAM available; build held")
        run(config["checks"])
        # Optional explicit public frontend build inputs, never runtime secrets.
        public_args = []
        for name, variable in config.get("public_build_args", {}).items():
            require(re.fullmatch(r"NEXT_PUBLIC_[A-Z0-9_]+", name) and name == variable, "public build input")
            value = os.environ[variable]
            require(value and "\n" not in value and "\r" not in value, "single-line public build input")
            public_args += ["--build-arg", name + "=" + value]
        for component, image in config["images"].items():
            require(set(image) in ({"repository", "context", "dockerfile"}, {"repository", "context", "dockerfile", "target"}), "build contract; public config belongs at runtime")
            require(re.fullmatch(r"[a-z0-9]+(?:[._/-][a-z0-9]+)*", image["repository"]), "repository")
            require(not image["context"].startswith("-") and not image["dockerfile"].startswith("-"), "build path")
            for path in (image["context"], image["dockerfile"]):
                require(Path(path).resolve().is_relative_to(Path.cwd().resolve()), "build path outside checkout")
            target_args = []
            if image.get("target"):
                require(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}", image["target"]), "build target")
                target_args = ["--target", image["target"]]
            run(["podman", "build", "--layers", "--platform", "linux/amd64", "--pull=missing", "--label",
                 "org.opencontainers.image.revision=" + sha, "--label",
                 "org.opencontainers.image.version=" + release, "--label",
                 "org.opencontainers.image.source=https://github.com/" + repository,
                 "--tag", config["registry"] + "/" + image["repository"] + ":" + release,
                 "--file", image["dockerfile"], *target_args, *public_args, image["context"]])
        if config.get("post_build_checks"):
            run(config["post_build_checks"])


def login(config, directory):
    password = aws(config, "ecr", "get-login-password")
    print("::add-mask::" + password, flush=True)
    authfile = str(Path(directory) / "auth.json")
    run(["podman", "login", "--authfile", authfile, "--username", "AWS", "--password-stdin", config["registry"]],
        input=password.encode(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return authfile


def publish(config):
    *_, release = identity(config)
    with tempfile.TemporaryDirectory(prefix="registry-") as directory:
        authfile = login(config, directory)
        for image in config["images"].values():
            tag = config["registry"] + "/" + image["repository"] + ":" + release
            run(["podman", "push", "--authfile", authfile, tag], stderr=subprocess.DEVNULL)
    verified = manifest(config)
    print("RELEASE_MANIFEST=" + json.dumps(verified, sort_keys=True), flush=True)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write("release_id=" + verified["release_id"] + "\n")


def manifest(config):
    sha, ref, source_repository, release = identity(config, existing=True)
    images = {}
    for name, image in config["images"].items():
        digest = aws(config, "ecr", "describe-images", "--repository-name", image["repository"],
                     "--image-ids", "imageTag=" + release, "--query", "imageDetails[0].imageDigest", "--output", "text")
        images[name] = config["registry"] + "/" + image["repository"] + "@" + digest
    for component, image_uri in images.items():
        image_repository, digest = image_uri.split("/", 1)[1].split("@")
        scan = check_basic_scan(config, image_repository, digest)
        print("IMAGE_SCAN=" + json.dumps({"component": component, **scan}, sort_keys=True), flush=True)
    return validate({"version": 1, "project": config["project"], "environment": config["environment"],
                     "contract_version": config["contract_version"], "release_id": release,
                     "sources": {source_repository: {"revision": sha, "ref": ref}}, "images": images}, config)


def deploy(config):
    timeout = config.get("ssh_timeout_seconds", 1500)
    require(type(timeout) is int and 300 <= timeout <= 9000, "bounded SSH timeout")
    release = manifest(config)  # Reconstruct non-secret manifest; no local build-cache assumption.
    password = aws(config, "ecr", "get-login-password")
    print("::add-mask::" + password, flush=True)
    host, user = os.environ["DEPLOY_HOST"], os.environ["DEPLOY_USER"]
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}", host), "host")
    require(re.fullmatch(r"[a-z_][a-z0-9_-]{0,62}", user), "SSH user")
    with tempfile.TemporaryDirectory(prefix="deploy-ssh-") as directory:
        key, known = (Path(directory) / n for n in ("identity", "known_hosts"))
        key.write_text(os.environ["DEPLOY_SSH_KEY"].rstrip() + "\n")
        known.write_text(os.environ["DEPLOY_KNOWN_HOSTS"].rstrip() + "\n")
        key.chmod(0o600)
        known.chmod(0o600)
        envelope = {"manifest": release, "registry_password": password}
        if config.get("runtime_from_actions"):
            from runtime_environment import from_environment
            envelope["runtime"] = from_environment(os.environ)
        payload = json.dumps(envelope).encode()
        result = subprocess.run(["ssh", "-F", "/dev/null", "-T", "-i", str(key), "-o", "BatchMode=yes",
                      "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + str(known),
                      "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4",
                      user + "@" + host], input=payload, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
        receipt = json.loads(result.stdout)
        if result.returncode:
            print(json.dumps({"deployment_status": receipt.get("status"), "release_id": release["release_id"]}), flush=True)
            raise RuntimeError("Deployment failed; check the host receipt before retrying")
        require(receipt.get("status") in config.get("deployment_receipts", ["applied"]) and receipt.get("project") == config["project"] and
                receipt.get("environment") == config["environment"] and
                receipt.get("release_id") == release["release_id"], "verified deployment receipt required")
    print(json.dumps({"release": release, "deployment": receipt}, sort_keys=True))


if __name__ == "__main__":
    require(len(sys.argv) == 3 and sys.argv[1] in {"build", "publish", "deploy"}, "pipeline command")
    config = json.loads(Path(sys.argv[2]).read_text())
    globals()[sys.argv[1]](config)
