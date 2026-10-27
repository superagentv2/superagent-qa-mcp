from pathlib import Path
import json,os,re,subprocess,tempfile
from pipeline import manifest,aws,require

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
        if config.get("rehearsal_database_password"):
            require(config["project"] == "superagent-dev-backend" and config["environment"] == "rehearsal", "backend rehearsal only")
            secret = os.environ["AWS_REHEARSAL_DB_PASSWORD"]
            require(secret and "\n" not in secret and "\r" not in secret, "single-line rehearsal database password")
            envelope["rehearsal_database_password"] = secret
        payload = json.dumps(envelope).encode()
        result = subprocess.run(["ssh", "-F", "/dev/null", "-T", "-i", str(key), "-o", "BatchMode=yes",
                      "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + str(known),
                      "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4",
                      user + "@" + host], input=payload, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
        receipt = json.loads(result.stdout)
        if result.returncode:
            print(json.dumps({"deployment_status": receipt.get("status"), "release_id": release["release_id"]}), flush=True)
            raise RuntimeError("Deployment failed; check the host receipt before retrying")
        require(receipt.get("status") == "applied" and receipt.get("project") == config["project"] and
                receipt.get("environment") == config["environment"] and
                receipt.get("release_id") == release["release_id"], "verified deployment receipt required")
    print(json.dumps({"release": release, "deployment": receipt}, sort_keys=True))


if __name__ == '__main__':
    deploy(json.loads(Path('.delivery/project.json').read_text()))
