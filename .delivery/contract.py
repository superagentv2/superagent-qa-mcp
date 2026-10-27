"""Small provider-independent release contract; no secrets belong in a manifest."""
import re

NAME = r"[a-z][a-z0-9-]{0,62}"
RELEASE = r"[0-9a-f]{40}-[0-9]{1,20}-[0-9]{1,6}"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(manifest, config):
    require(isinstance(manifest, dict), "manifest must be an object")
    require(set(manifest) == {"version", "project", "environment", "contract_version",
                             "release_id", "sources", "images"}, "manifest fields differ")
    require(type(manifest["version"]) is int and manifest["version"] == 1, "version")
    for name in ("project", "environment"):
        require(isinstance(manifest[name], str) and re.fullmatch(NAME, manifest[name]), name)
        require(manifest[name] == config[name], name + " target mismatch")
    require(manifest["contract_version"] == config["contract_version"], "host contract mismatch")
    require(isinstance(manifest["release_id"], str) and re.fullmatch(RELEASE, manifest["release_id"]), "release ID")
    sources = manifest["sources"]
    require(isinstance(sources, dict) and set(sources) == set(config["allowed_sources"]), "source set differs")
    for repository, source in sources.items():
        require(isinstance(source, dict) and set(source) == {"revision", "ref"}, "source fields")
        require(isinstance(source["revision"], str) and re.fullmatch(r"[0-9a-f]{40}", source["revision"]), "source revision")
        require(source["ref"] in config["allowed_sources"][repository], "release branch not allowed")
    images = manifest["images"]
    require(isinstance(images, dict) and set(images) == set(config["images"]), "complete image bundle required")
    registry = config["registry"]
    require(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}", registry), "registry")
    for component, image in images.items():
        expected = registry + "/" + config["images"][component]["repository"] + "@sha256:"
        require(isinstance(image, str) and image.startswith(expected), "wrong image repository")
        require(re.fullmatch(re.escape(expected) + r"[0-9a-f]{64}", image), "digest image required")
    return manifest


class RolledBack(RuntimeError):
    pass


def apply_bundle(candidate, previous, driver):
    """Driver is fixed host code. Failed candidate always fails CI, even after recovery."""
    driver.pull(candidate)
    driver.pull(previous)  # Guarantee rollback images exist before touching the app.
    driver.journal("applying", candidate)
    try:
        driver.up(candidate)
        driver.smoke()
    except Exception as candidate_error:
        driver.journal("rolling-back", candidate)
        try:
            driver.up(previous)
            driver.smoke()
        except Exception as rollback_error:
            driver.journal("manual-recovery-required", candidate)
            raise RuntimeError("candidate and rollback failed; operator recovery required") from rollback_error
        driver.journal("rolled-back", candidate)
        raise RolledBack("candidate failed; previous bundle restored and verified") from candidate_error
    driver.commit(candidate, previous)
    driver.journal("applied", candidate)
