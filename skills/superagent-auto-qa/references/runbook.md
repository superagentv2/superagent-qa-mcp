# Runbook

Run commands from `superagentv2_agent`.

## Activate Runner API

```bash
python runner_api.py
# or
uvicorn runner_api:app --host 0.0.0.0 --port 8090
```

Frontend proxy expects the runner at `QA_RUNNER_INTERNAL_URL` or local port
`8090`.

## Quick Health

```bash
curl -s http://localhost:8090/health
curl -s http://localhost:8090/eval/tests?per_page=5
```

## Full Manifest For Codex Authoring

```bash
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_manifest.py --root . --out /tmp/qa-manifest.json
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_manifest.py --root . --require-business-schema --out /tmp/qa-manifest.json
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_manifest.py --root . --source local --jurisdiction AZ
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_manifest.py --source api --runner-url http://localhost:8090
```

Use this before writing tests so field names, addendum slugs, assertion kinds,
suites, profiles, and lifecycle values come from the current code/backend
manifest.

The backend business manifest can take 30+ seconds locally because it transforms
published pdfMe templates. The runner default timeout is controlled by
`QA_BUSINESS_MANIFEST_TIMEOUT_SECONDS` and should be at least `120` for local
authoring.

`qa_manifest.py` loads environment values before selecting URLs. Load order is:
explicit `--env-file` values, agent `.env.local`, `.env.dev`, `.env`, frontend
`.env`, then backend `.env`; already-exported shell variables win. Backend
manifest URL precedence is `QA_BUSINESS_MANIFEST_URL`, then
`TEST_BACKEND_URL`, `BACKEND_URL`, then `NEXT_PUBLIC_API_BASE_URL`, with
`/v1/admin/qa/manifest/business-schema` appended to the selected backend base.
Auth uses `QA_MANIFEST_BACKEND_TOKEN`/`BACKEND_SERVICE_TOKEN` for bearer auth
or `BACKEND_API_KEY` for `X-API-KEY`.

## Documentation Bundle

```bash
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_docs.py --root . --list
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_docs.py --root . --out /tmp/superagent-qa-docs.md
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_docs.py --root . --no-ui --out /tmp/superagent-qa-repo-docs.md
```

Use the list mode before opening large docs. Use bundle mode when a future MCP,
subagent, or offline Codex session needs a portable QA documentation snapshot.

## Current Catalog Inventory

```bash
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_catalog.py --root .
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_catalog.py --root . --json --out /tmp/qa-catalog.json
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_catalog.py --root . --type e2e
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_catalog.py --root . --type microtest
```

Use this to learn current tests, snapshots, lifecycle values, missing explicit
`test_type`, and YAML references without relying on folder conventions.

## E2E

```bash
python evaluate.py e2e simulations/regressions/cross-flow/ACT-flat-cash-happy.yaml --live
python evaluate.py e2e simulations/regressions/cross-flow/ACT-flat-cash-happy.yaml --save-log
python evaluate.py e2e simulations/regressions/cross-flow/ACT-flat-cash-happy.yaml --offline-backend --save-log
```

Use `--live` for human-readable turn output. Use `--save-log` for JSON/Markdown
artifacts under `artifacts/eval-runs/`.

An E2E with a top-level relative `snapshot` path uses the same command and
admin/MCP dispatcher. There is no separate resume command:

```yaml
test_type: e2e
snapshot: ../snapshots/purchase-review-ready.json
```

Require a version 3 artifact with `backend_state`, matching `user_id`,
`contract_type`, `mode`, and `mode_style`; do not combine it with
`seed_scenario`. In an API run, poll PREPARE events for checkpoint loading,
fresh-room backend hydration, Edit initialization, ID remapping, and runtime
restoration. `checkpoint_restored` marks entry into ordinary execution, and the
saved report records `resume_context`. A failure before that event is a resume
setup failure, not an assertion failure.

## Extraction

```bash
python evaluate.py extraction simulations/extraction/EXT-purchase-cash-gate.yaml --save-log
python evaluate.py extraction-all --dir simulations/extraction --category purchase --save-log
```

Use `--repeat N --min-pass-rate X` for reliability checks.

## Micro-Tests

```bash
python evaluate.py micro-test simulations/microtests/addenda/example.yaml --offline-backend --save-report
python evaluate.py micro-test simulations/microtests/addenda/example.yaml --live
```

Default admin dispatcher uses `--offline-backend` for micro-tests.

## Generate And Triage Snapshot Bundles Through MCP

Use the bundle tools rather than creating JSON directly:

1. `qa_files_tree_get`
2. `qa_snapshot_bundle_create` for a new fixture, or
   `qa_snapshot_bundle_get` for an existing `bundleId`
3. `qa_snapshot_recipe_validate`
4. `qa_snapshot_recipe_save` with `expectedHash`
5. `qa_snapshot_generate`
6. Poll `qa_job_get` until `passed`, `failed`, `error`, or `canceled`
7. `qa_snapshot_bundle_get` to confirm final bundle state

Generation phases are queued, recipe preparation, E2E execution, candidate
validation, artifact persistence, and completion. A successful job is not the
only acceptance signal: require `generation_status: ready` and
`artifact_available: true` from the refreshed bundle.

New generation emits version 3 checkpoints with both reconstructable agent
state and restricted backend hydration state. These artifacts can feed resumed
E2E tests or offline microtests. Legacy versions 1 and 2 remain microtest-only.
The source snapshot is never mutated during E2E hydration, but continued
E2E uses real tools and backend behavior; use synthetic users and safe test
destinations.

For a failed generation:

- Read the job `error`, events, room/user metadata, and `run_id`.
- Use `qa_run_get` for the saved E2E artifact when a run ID is present.
- `snapshot capture gate was never reached` means E2E never satisfied the
  declared event/task gate.
- `capture gate was reached, but capture failed` means the runtime state was not
  safely serializable or was an unsupported agent state.
- Fatal initialization or missing runtime-state errors mean the candidate was
  rejected after capture validation.
- Checkpoint E2E identity errors mean the consumer and snapshot disagree on
  user, contract type, mode, or mode style.
- Backend hydration or Edit initialization errors belong to PREPARE; inspect
  the job events and `resume_context` before changing test assertions.
- Correct the recipe/environment and retry. The last valid JSON remains in
  place after failure.

Use `qa_job_cancel` only when cancellation is requested. Do not edit generated
JSON to turn a failed generation green; raw editing bypasses the reproducible
recipe path and marks the bundle manually modified.

## Suites And Profiles

```bash
python evaluate.py eval-suite purchase-e2e --dry-run
python evaluate.py eval-suite purchase-e2e --save-log
python evaluate.py eval-suite --profile pr --dry-run
python evaluate.py eval-suite --profile nightly --save-log
```

Known suite names are defined in `evaluate.py` under the `eval-suite` parser.
Known profiles are in `EVAL_PROFILES`.

## Real Room To Candidate

```bash
python evaluate.py e2e-from-room --room-id <room_id> --jira DEV-XXX --generate-only
python evaluate.py e2e-from-room --room-id <room_id> --jira DEV-XXX --mode hybrid --live --save-log
```

For authenticated debug imports, use `--bearer-token-stdin` or
`--bearer-token-env`. Never print tokens.

## Generate Scenario CLI

```bash
python evaluate.py generate-scenario "cash purchase, buyer provides all info upfront" --out simulations/regressions/generated/QA-CASH.yaml
python evaluate.py generate-scenario "financed purchase with HOA addendum" --run --live
```

The admin UI should prefer `POST /eval/generate-scenario-draft`, because it is
manifest-grounded and returns lint/review metadata.

## Category Runs

```bash
python evaluate.py run-category qa-init-p0 --dry-run
python evaluate.py run-category qa-init-p0 --area init --priority p0 --save-report
```

Use this for taxonomy-driven batches across E2E and micro-tests.

## Validation

```bash
.venv/bin/python -m py_compile runner_api.py evaluate.py
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_inventory.py --root .
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_catalog.py --root .
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_docs.py --root . --list
```

For frontend changes:

```bash
cd ../superagentv2_frontend
npx tsc --noEmit
```
