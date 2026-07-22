#!/usr/bin/env python3
"""Run guarded read-only SuperAgent database queries from a local env file."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path
from typing import Optional


DEFAULT_ENV_FILE = Path("~/.config/superagent/admin-db.env").expanduser()
READ_PREFIXES = ("select", "with", "show", "explain")
SCHEMA_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
BLOCKED_WORDS = {
    "insert",
    "update",
    "delete",
    "alter",
    "drop",
    "truncate",
    "create",
    "grant",
    "revoke",
    "merge",
    "call",
    "copy",
    "execute",
    "do",
    "vacuum",
    "analyze",
    "reindex",
    "cluster",
    "refresh",
    "comment",
    "notify",
    "listen",
    "unlisten",
    "begin",
    "commit",
    "rollback",
    "savepoint",
}


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


def normalize_env(args_env: Optional[str], values: dict[str, str]) -> str:
    env_name = args_env or values.get("SUPERAGENT_DEFAULT_ENV") or "dev"
    return env_name.lower().replace("-", "_")


def strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def validate_read_only(sql: str) -> str:
    compact = strip_sql_comments(sql).strip()
    if not compact:
        raise SystemExit("empty SQL")
    if re.search(r"(?m)^\s*\\", compact):
        raise SystemExit("psql meta-commands are not allowed")
    first = re.match(r"^\s*([A-Za-z]+)", compact)
    if not first or first.group(1).lower() not in READ_PREFIXES:
        raise SystemExit("only SELECT/WITH/SHOW/EXPLAIN read queries are allowed")
    words = {word.lower() for word in re.findall(r"\b[A-Za-z_]+\b", compact)}
    blocked = sorted(words & BLOCKED_WORDS)
    if blocked:
        raise SystemExit(f"blocked SQL keyword(s): {', '.join(blocked)}")
    return compact.rstrip().rstrip(";")


def normalize_schema(schema: str) -> str:
    value = schema.strip()
    if not value:
        return ""
    if not SCHEMA_NAME_RE.match(value):
        raise SystemExit("invalid schema name in database URL currentSchema")
    return value


def quote_identifier(identifier: str) -> str:
    return f'"{normalize_schema(identifier)}"'


def should_default_ssl(hostname: str) -> bool:
    host = hostname.lower()
    return bool(host) and host not in {"localhost", "127.0.0.1", "::1"}


def clean_postgres_query(query: str) -> tuple[str, str, str]:
    schema = ""
    sslmode = ""
    clean_pairs: list[tuple[str, str]] = []
    for key, value in urllib.parse.parse_qsl(query, keep_blank_values=True):
        key_lower = key.lower()
        if key_lower in {"currentschema", "current_schema"}:
            schema = normalize_schema(value)
            continue
        if key_lower == "sslmode":
            sslmode = value
        clean_pairs.append((key, value))
    return urllib.parse.urlencode(clean_pairs), schema, sslmode


def parse_database_url(db_url: str) -> tuple[list[str], dict[str, str], str, str]:
    if db_url.startswith("jdbc:postgresql://"):
        raw = "postgresql://" + db_url[len("jdbc:postgresql://") :]
        is_jdbc = True
    elif db_url.startswith(("postgresql://", "postgres://")):
        raw = db_url
        is_jdbc = False
    else:
        return [db_url], {}, "unknown-host", ""

    parsed = urllib.parse.urlparse(raw)
    clean_query, schema, sslmode = clean_postgres_query(parsed.query)
    hostname = parsed.hostname or ""
    env: dict[str, str] = {}
    if sslmode:
        env["PGSSLMODE"] = sslmode
    elif not os.environ.get("PGSSLMODE") and should_default_ssl(hostname):
        env["PGSSLMODE"] = "require"

    if not is_jdbc:
        clean_url = urllib.parse.urlunparse(parsed._replace(query=clean_query))
        return [clean_url], env, hostname or "unknown-host", schema

    args = [
        "-h",
        hostname,
        "-p",
        str(parsed.port or 5432),
        "-d",
        parsed.path.lstrip("/") or "postgres",
    ]
    return args, env, hostname or "unknown-host", schema


def connection_args(values: dict[str, str], env_name: str) -> tuple[list[str], dict[str, str], str, str]:
    database_url = env_value(values, "SUPERAGENT_DATABASE_URL", env_name)
    db_url = env_value(values, "SUPERAGENT_DB_URL", env_name)
    username = env_value(values, "SUPERAGENT_DB_USERNAME", env_name)
    password = env_value(values, "SUPERAGENT_DB_PASSWORD", env_name)
    extra_env: dict[str, str] = {}
    if database_url:
        args, url_env, label, schema = parse_database_url(database_url)
        extra_env.update(url_env)
    elif db_url:
        args, url_env, label, schema = parse_database_url(db_url)
        extra_env.update(url_env)
    else:
        raise SystemExit(f"missing SUPERAGENT_DATABASE_URL_{env_name.upper()} or SUPERAGENT_DB_URL_{env_name.upper()}")
    if username:
        extra_env["PGUSER"] = username
    if password:
        extra_env["PGPASSWORD"] = password
    return args, extra_env, label or "unknown-host", schema


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", help="Environment suffix: dev, staging, prod")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--sql", help="Read-only SQL to execute")
    parser.add_argument("--file", type=Path, help="File containing read-only SQL")
    parser.add_argument("--csv", action="store_true", help="Emit CSV output")
    args = parser.parse_args()

    if bool(args.sql) == bool(args.file):
        raise SystemExit("provide exactly one of --sql or --file")
    if shutil.which("psql") is None:
        raise SystemExit("psql is required but was not found on PATH")

    values = parse_env_file(args.env_file.expanduser())
    env_name = normalize_env(args.env, values)
    sql = args.sql if args.sql else args.file.read_text(encoding="utf-8")
    safe_sql = validate_read_only(sql)
    conn_args, extra_env, host_label, schema = connection_args(values, env_name)

    schema_sql = f"set local search_path to {quote_identifier(schema)};\n" if schema else ""
    wrapped = f"begin transaction read only;\n{schema_sql}{safe_sql};\ncommit;\n"
    cmd = ["psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", *conn_args]
    if args.csv:
        cmd.append("--csv")
    cmd.extend(["-f", "-"])
    env = os.environ.copy()
    env.update(extra_env)

    print(f"SUPERAGENT_DB_QUERY env={env_name} host={host_label} readonly=True", file=sys.stderr)
    with tempfile.TemporaryFile("w+") as stdin:
        stdin.write(wrapped)
        stdin.seek(0)
        result = subprocess.run(cmd, stdin=stdin, env=env, check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
