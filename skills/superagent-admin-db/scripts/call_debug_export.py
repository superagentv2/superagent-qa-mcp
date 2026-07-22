#!/usr/bin/env python3
"""Export SuperAgent call debug evidence by room id or admin debug URL."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional


DEFAULT_ENV_FILE = Path("~/.config/superagent/admin-db.env").expanduser()
ROOM_RE = re.compile(r"(room-[0-9A-Za-z-]+)")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
SIGNED_URL_RE = re.compile(r"https?://[^\s\"']*(?:X-Amz-|Signature=|token=|jwt=)[^\s\"']*", re.I)
SECRET_KEY_RE = re.compile(r"(api[_-]?key|token|password|secret|authorization|signedUrl|recordingUrl)", re.I)


def parse_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        raise SystemExit(f"env file missing: {path}")
    pattern = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$")
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        match = pattern.match(raw)
        if not match:
            continue
        key, value = match.group(1), match.group(2).strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        values[key] = value
    return values


def env_value(values: dict[str, str], name: str, env_name: str) -> str:
    suffix = env_name.upper().replace("-", "_")
    return values.get(f"{name}_{suffix}", "") or os.environ.get(f"{name}_{suffix}", "")


def normalize_backend_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if not value:
        return ""
    if not re.match(r"^https?://", value):
        value = "https://" + value
    if not value.endswith("/api"):
        value += "/api"
    return value


def room_id_from_args(room_id: Optional[str], debug_url: Optional[str]) -> str:
    if room_id:
        return room_id
    match = ROOM_RE.search(debug_url or "")
    if not match:
        raise SystemExit("provide --room-id or a --debug-url containing room-...")
    return match.group(1)


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for key, item in value.items():
            if SECRET_KEY_RE.search(str(key)):
                clean[key] = "[redacted]"
            else:
                clean[key] = redact(item)
        return clean
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str):
        value = SIGNED_URL_RE.sub("[signed-url]", value)
        value = EMAIL_RE.sub("[email]", value)
        return value
    return value


def request_json(base_url: str, headers: dict[str, str], path: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    query = "" if not params else "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(base_url + path + query, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data if isinstance(data, dict) else {"value": data}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", help="Environment suffix: dev, staging, prod")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--room-id")
    parser.add_argument("--debug-url")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    values = parse_env_file(args.env_file.expanduser())
    env_name = (args.env or values.get("SUPERAGENT_DEFAULT_ENV") or "dev").lower().replace("-", "_")
    room_id = room_id_from_args(args.room_id, args.debug_url)
    backend_url = normalize_backend_url(env_value(values, "SUPERAGENT_BACKEND_URL", env_name))
    api_key = env_value(values, "SUPERAGENT_BACKEND_API_KEY", env_name)
    bearer = env_value(values, "SUPERAGENT_ADMIN_BEARER_TOKEN", env_name)
    if not backend_url:
        raise SystemExit(f"missing SUPERAGENT_BACKEND_URL_{env_name.upper()}")
    if not api_key:
        raise SystemExit(f"missing SUPERAGENT_BACKEND_API_KEY_{env_name.upper()}")

    parsed = urllib.parse.urlparse(backend_url)
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": api_key,
        "User-Agent": "SuperAgentAdminDbSkill/1.0",
    }
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"

    started = time.time()
    errors: dict[str, str] = {}
    sources: dict[str, Any] = {}
    endpoints = {
        "voice_session": (f"/v1/admin/voice-sessions/by-room/{urllib.parse.quote(room_id)}", None),
        "trace_current_state": ("/v1/livekit/trace/current-state", {"roomId": room_id}),
        "trace_history": (
            "/v1/livekit/trace/history",
            {"roomId": room_id, "sinceEventId": 0, "sinceUserTurnId": 0, "sinceAgentTurnId": 0},
        ),
        "trace_metadata": ("/v1/livekit/trace/metadata", {"roomId": room_id}),
    }
    for name, (path, params) in endpoints.items():
        try:
            sources[name] = request_json(backend_url, headers, path, params)
        except Exception as exc:
            errors[name] = str(exc)

    history = sources.get("trace_history") if isinstance(sources.get("trace_history"), dict) else {}
    payload = {
        "kind": "superagent_call_debug_export",
        "env": env_name,
        "backend_host": parsed.netloc,
        "room_id": room_id,
        "debug_url": args.debug_url or "",
        "duration_ms": round((time.time() - started) * 1000),
        "counts": {
            "trace_events": len((history or {}).get("events") or []),
            "user_turns": len((history or {}).get("userTurns") or []),
            "agent_turns": len((history or {}).get("agentTurns") or []),
        },
        "sources_present": {key: key in sources for key in endpoints},
        "sources": redact(sources),
        "errors": errors,
    }

    out = args.out or Path(f"/tmp/superagent-call-debug-{room_id}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "env": env_name,
                "backend_host": parsed.netloc,
                "room_id": room_id,
                "sources_present": payload["sources_present"],
                "counts": payload["counts"],
                "artifact": str(out),
                "errors": errors,
            },
            indent=2,
        )
    )
    return 1 if errors and not sources else 0


if __name__ == "__main__":
    raise SystemExit(main())
