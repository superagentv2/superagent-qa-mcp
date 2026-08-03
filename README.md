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
- File explorer tree/list/content, folder create, coordinated rename/move, and
  delete. Rename and move preserve YAML references, managed snapshot paths, and
  path-based playlist IDs.
- Snapshot bundle creation/read, replay-recipe validation/save, manual artifact
  override, and asynchronous generation. Generated checkpoints can feed resumed
  replays or offline microtests. Generation uses the generic job get/cancel tools
  for progress and cancellation.
- Requirements and coverage read/write/bulk mutation.
- Runs, run markdown, jobs, cancel, single run, bulk run, suite run, profile
  run, and triage.
- Legacy scenario compatibility endpoints.

Snapshot replay recipes are the source of truth for newly created fixtures. New
generation produces a version 3 checkpoint containing reconstructable agent
state and a restricted backend hydration seed. Versions 1 and 2 remain usable by
offline microtests but cannot start a resumed replay.

`qa_snapshot_artifact_save` is the validated manual override for managed bundle
artifacts. `qa_file_content_save` remains a lower-level escape hatch for
deliberate edits to an existing JSON file; it does not create missing snapshots.
Either manual path marks a generated artifact as manually modified, and later
generation replaces it.

### Resumed Replay Workflow

1. Find the replay and checkpoint with `qa_catalog_search` and
   `qa_snapshot_bundle_get`, then read the YAML with `qa_definition_get`.
2. Keep `test_type: replay` explicit and add a `snapshot` path relative to the
   replay YAML. Do not combine it with `seed_scenario`.
3. Require a version 3 artifact with `backend_state`, and match `user_id`,
   `contract_type`, `mode`, and `mode_style` to the captured identity.
4. Run `qa_lint_definition` with the replay's `testId` so its relative snapshot
   path and captured identity are checked immediately. Save with
   `qa_definition_save`, then launch with the ordinary `qa_test_run` tool. No
   special resume tool is required.
5. Poll `qa_job_get`. The `preparing` events expose checkpoint loading, isolated
   backend hydration, identifier remapping, and runtime restoration before the
   `snapshot_resumed` event hands control to normal execution.
6. Inspect the saved run with `qa_run_get`; catalog rows expose `start_mode` and
   `snapshot_path`, while the run report records `resume_context`.

The source checkpoint is immutable and backend records are cloned into a fresh
room, but execution after resume is not offline: it uses the real agent, tools,
backend behavior, and any side effects allowed by that test environment. Use
synthetic identities and safe test destinations.

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
- A `superagent-admin-db` skill for read-only SuperAgent database inspection
  and admin debug evidence export from room/debug links.

The plugin does not include secrets. Admin users provide only `MCP_TOKEN`.
`QA_RUNNER_TOKEN` stays in the hosted MCP environment.

### Install the Codex Plugin

Install the plugin from the SuperAgent marketplace repo:

```bash
codex plugin marketplace add https://github.com/superagentv2/superagent-qa-mcp.git
codex plugin add superagent-qa@superagent
```

Then restart Codex so the plugin skill and MCP server are loaded.

Verify the plugin is available:

```bash
codex plugin list
codex mcp list
```

`codex plugin list` should include `superagent-qa@superagent`.
`codex mcp list` should include `superagent_qa`.

If the marketplace was already added and the plugin install is being repaired,
remove and add the plugin again:

```bash
codex plugin remove superagent-qa
codex plugin add superagent-qa@superagent
```

### Set MCP_TOKEN Permanently

The plugin reads the admin-facing MCP token from the `MCP_TOKEN` environment
variable. Do not put `QA_RUNNER_TOKEN` on tester machines.

#### macOS zsh

```bash
mkdir -p ~/.config/superagent
nano ~/.config/superagent/qa-mcp.env
```

Add:

```bash
export MCP_TOKEN="admin-facing-mcp-secret"
```

Lock down the file and load it from zsh:

```bash
chmod 600 ~/.config/superagent/qa-mcp.env
printf '\n[ -f ~/.config/superagent/qa-mcp.env ] && source ~/.config/superagent/qa-mcp.env\n' >> ~/.zshrc
source ~/.zshrc
```

Verify without printing the token:

```bash
test -n "$MCP_TOKEN" && echo "MCP_TOKEN is set"
```

#### Linux bash

```bash
mkdir -p ~/.config/superagent
nano ~/.config/superagent/qa-mcp.env
```

Add:

```bash
export MCP_TOKEN="admin-facing-mcp-secret"
```

Lock down the file and load it from bash:

```bash
chmod 600 ~/.config/superagent/qa-mcp.env
printf '\n[ -f ~/.config/superagent/qa-mcp.env ] && source ~/.config/superagent/qa-mcp.env\n' >> ~/.bashrc
source ~/.bashrc
```

Verify without printing the token:

```bash
test -n "$MCP_TOKEN" && echo "MCP_TOKEN is set"
```

If the user uses zsh on Linux, add the same source line to `~/.zshrc` instead.

#### Windows PowerShell

Set a persistent user environment variable:

```powershell
[Environment]::SetEnvironmentVariable("MCP_TOKEN", "admin-facing-mcp-secret", "User")
```

Close and reopen PowerShell or restart Codex.

Verify without printing the token:

```powershell
if ($env:MCP_TOKEN) { "MCP_TOKEN is set" } else { "MCP_TOKEN is missing" }
```

#### Windows Command Prompt

```cmd
setx MCP_TOKEN "admin-facing-mcp-secret"
```

Close and reopen Command Prompt or restart Codex.

Verify without printing the token:

```cmd
if defined MCP_TOKEN (echo MCP_TOKEN is set) else (echo MCP_TOKEN is missing)
```

### Update the Codex Plugin

There are two update paths:

- Hosted MCP server changes: deploy this repo. Users do not need to reinstall
  the plugin if `.mcp.json` and the skill text did not change.
- Plugin package changes: update/reinstall the plugin so Codex refreshes the
  bundled `.mcp.json`, plugin metadata, and `superagent-auto-qa` skill.

After plugin files are changed and pushed, users should run:

```bash
codex plugin marketplace upgrade superagent
codex plugin remove superagent-qa
codex plugin add superagent-qa@superagent
```

Then restart Codex.

Use this update flow when any of these files change:

```text
.codex-plugin/plugin.json
.mcp.json
.agents/plugins/marketplace.json
skills/
```

If only `MCP_TOKEN` changes, update the local environment variable and restart
Codex. No plugin reinstall is needed.

### Configure SuperAgent Admin DB Credentials

The `superagent-admin-db` skill does not include credentials. QA users who need
database or admin-debug access should create a local env file:

```bash
mkdir -p ~/.config/superagent
nano ~/.config/superagent/admin-db.env
chmod 600 ~/.config/superagent/admin-db.env
```

Populate it with the values supplied by the SuperAgent team:

```env
SUPERAGENT_DEFAULT_ENV=dev

SUPERAGENT_BACKEND_URL_DEV=https://back-dev.superagent.estate/api
SUPERAGENT_BACKEND_API_KEY_DEV=
SUPERAGENT_ADMIN_BEARER_TOKEN_DEV=

SUPERAGENT_DATABASE_URL_DEV=
SUPERAGENT_DB_URL_DEV=
SUPERAGENT_DB_USERNAME_DEV=
SUPERAGENT_DB_PASSWORD_DEV=
```

Use `SUPERAGENT_DATABASE_URL_<ENV>` for a `postgresql://` URL. If the team
provides Spring/JDBC values instead, use `SUPERAGENT_DB_URL_<ENV>` as
`jdbc:postgresql://...` plus `SUPERAGENT_DB_USERNAME_<ENV>` and
`SUPERAGENT_DB_PASSWORD_<ENV>`.

DEV and staging can use the same physical database with different schemas, for
example `?currentSchema=superagent_dev_schema` and
`?currentSchema=superagent_staging_schema`. The helper applies that schema
inside a read-only transaction and defaults SSL on for non-local database hosts.

Optional staging/prod credentials can use the same suffix pattern:

```text
SUPERAGENT_BACKEND_URL_STAGING
SUPERAGENT_BACKEND_API_KEY_STAGING
SUPERAGENT_ADMIN_BEARER_TOKEN_STAGING
SUPERAGENT_DATABASE_URL_STAGING
SUPERAGENT_DB_URL_STAGING
SUPERAGENT_DB_USERNAME_STAGING
SUPERAGENT_DB_PASSWORD_STAGING

SUPERAGENT_BACKEND_URL_PROD
SUPERAGENT_BACKEND_API_KEY_PROD
SUPERAGENT_ADMIN_BEARER_TOKEN_PROD
SUPERAGENT_DATABASE_URL_PROD
SUPERAGENT_DB_URL_PROD
SUPERAGENT_DB_USERNAME_PROD
SUPERAGENT_DB_PASSWORD_PROD
```

Do not commit this file. Do not paste database URLs, API keys, bearer tokens, or
passwords into Codex chat, Jira, docs, or reports. The bundled scripts parse the
file as inert dotenv text; do not `source` it.

For DEV testing, `.mcp.json` currently points at:

```text
http://88.198.201.6:3009/mcp
```

Before distributing the plugin broadly, change that URL to the deployed MCP
domain, for example:

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
