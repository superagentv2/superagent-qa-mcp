# SuperAgent QA MCP

MCP server that lets Codex interact with SuperAgent QA automation through the
QA Runner API, without direct access to the codebase.

## Development

```bash
npm install
npm run build
npm run dev
```

## Configuration

```env
QA_RUNNER_URL=http://localhost:8090
QA_RUNNER_TOKEN=
MCP_TRANSPORT=stdio
MCP_HOST=127.0.0.1
MCP_PORT=3009
MCP_ALLOWED_HOSTS=
MCP_TOKEN=
```

`QA_RUNNER_URL` points to the Python QA runner API. `QA_RUNNER_TOKEN` must match
the runner service token when the runner is protected; the MCP sends it as
`Authorization: Bearer ...` on every runner request.

`MCP_TRANSPORT=stdio` is for local Codex usage. In this mode there is no inbound
network listener, so `MCP_TOKEN` is not required.

`MCP_TRANSPORT=http` is for hosted deployments. In this mode `MCP_TOKEN` is
required and every `/mcp` request must send it as `Authorization: Bearer ...`.
The admin user gets `MCP_TOKEN`; the admin user does not get `QA_RUNNER_TOKEN`.
`QA_MCP_TOKEN` is accepted only as a backward-compatible fallback for older
local configs; use `MCP_TOKEN` going forward.

Hosted deployment shape:

```env
MCP_TRANSPORT=http
MCP_HOST=0.0.0.0
MCP_PORT=3009
MCP_ALLOWED_HOSTS=qa-mcp.superagent.estate
MCP_TOKEN=admin-facing-mcp-secret
QA_RUNNER_URL=http://qa-runner:8090
QA_RUNNER_TOKEN=private-runner-secret
```

## Docker DEV Deployment

This repo deploys as a standalone Docker Compose project on the SuperAgent
server. The DEV workflow builds and pushes `ghcr.io/superagentv2/superagent-qa-mcp:dev`,
copies `deployment/docker-compose.dev.yml` to:

```text
/srv/apps/superagent/superagent-qa-mcp
```

and restarts the compose project:

```bash
docker compose -p qa-mcp-dev -f docker-compose.dev.yml up -d --force-recreate
```

Required GitHub DEV environment secrets:

```text
HOST
SSH_USER
SSH_KEY
SSH_PORT
MCP_TOKEN
QA_RUNNER_TOKEN
```

Required GitHub DEV environment variables:

```text
QA_RUNNER_URL=http://host.docker.internal:8090
MCP_ALLOWED_HOSTS=
```

`MCP_ALLOWED_HOSTS` can stay empty while testing direct host/port access. Set it
to the hosted MCP domain once a reverse proxy is in front of the service.

## Tool Groups

The server exposes the QA automation API as MCP tools:

- Health, manifest, catalog search, and catalog read.
- Definition read/save, draft generation, draft creation, linting, lifecycle,
  and archive.
- File explorer tree/list/content, folder create, snapshot create, rename,
  move, and delete.
- Requirements and coverage read/write/bulk mutation.
- Runs, run markdown, jobs, cancel, single run, bulk run, suite run, profile
  run, and triage.
- Legacy scenario compatibility endpoints.

It also exposes read-only MCP resources:

- `qa://health`
- `qa://manifest/AZ`
- `qa://catalog`
- `qa://files/tree`
- `qa://requirements`
- `qa://coverage`

## Scope

This MCP does not read the SuperAgent codebase. It operates through
`QA_RUNNER_URL`, matching the Admin QA API behavior and safety gates.

## Codex Plugin

This repo also contains a Codex plugin wrapper:

```text
.codex-plugin/plugin.json
.mcp.json
skills/superagent-auto-qa/
```

The plugin installs:

- The hosted SuperAgent QA MCP config.
- A concise `superagent-auto-qa` skill that explains the QA automation system
  and tells Codex how to use the MCP safely.

The plugin does not include secrets. Admin users provide only `MCP_TOKEN`.
`QA_RUNNER_TOKEN` stays in the hosted MCP environment.

For local hosted-style testing, `.mcp.json` currently points at:

```text
http://127.0.0.1:3009/mcp
```

Before distributing the plugin broadly, change that URL to the deployed MCP
endpoint, for example:

```text
https://qa-mcp.superagent.estate/mcp
```

Direct MCP install without the plugin:

```bash
export MCP_TOKEN="admin-facing-mcp-secret"
codex mcp add superagent_qa \
  --url https://qa-mcp.superagent.estate/mcp \
  --bearer-token-env-var MCP_TOKEN
```
