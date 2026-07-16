# Admin UI Contract

## Shape

The admin QA app is at `/admin/qa` and implemented by:

- `../superagentv2_frontend/components/superagent/qa/QAWorkbench.tsx`
- `../superagentv2_frontend/lib/api/qa-runner.ts`
- frontend proxy routes under `../superagentv2_frontend/app/api/qa-runner/`

The browser calls Next.js proxy routes. The proxy calls the Python runner API.
Default local runner URL is port `8090`; set `QA_RUNNER_INTERNAL_URL` when
needed.

## Active Views

- Overview: dashboard metrics and health. No test list and no right context
  rail.
- Generate: natural language to draft YAML, lint, edit, and save draft.
- Catalog: file-explorer view rooted at `simulations/` with folders, YAML
  tests, JSON snapshots, context menu actions, and contextual detail rail.
- Runs: run history and active job detail.
- Coverage & Requirements: requirement categories from
  `docs/evaluation/requirements.yaml`, minimal requirement rows, selected-row
  detail in the shared right context rail, CRUD, bulk YAML editing, bulk delete,
  and computed coverage from test YAML `covers`.
- Quality Checks: visibility surface for check definitions.

## Runner API Endpoints Used By Admin

Main current endpoints in `runner_api.py`:

- `GET /health`
- `GET /eval/manifest`
- `POST /eval/generate-scenario-draft`
- `POST /eval/validate-scenario-draft`
- `GET /eval/tests`
- `POST /eval/tests/bulk-run`
- `POST /eval/tests/{test_id}/run`
- `POST /eval/tests/drafts`
- `GET /eval/tests/{test_id}/definition`
- `PUT /eval/tests/{test_id}/definition`
- `POST /eval/tests/{test_id}/lifecycle`
- `POST /eval/tests/{test_id}/archive`
- `GET /eval/files`
- `GET /eval/files/tree`
- `POST /eval/files/folders`
- `POST /eval/files/snapshots`
- `PATCH /eval/files/rename`
- `PATCH /eval/files/move`
- `DELETE /eval/files`
- `GET /eval/files/content`
- `PUT /eval/files/content`
- `GET /eval/runs`
- `GET /eval/runs/{run_id}`
- `GET /eval/runs/{run_id}/markdown`
- `GET /eval/jobs`
- `GET /eval/jobs/{job_id}`
- `POST /eval/jobs/{job_id}/cancel`
- `GET /eval/profiles`
- `POST /eval/profiles/{profile}/run`
- `POST /eval/suites/{suite}/run`
- `GET /eval/coverage`
- `GET /eval/requirements`
- `POST /eval/requirements`
- `PUT /eval/requirements/{requirement_id}`
- `DELETE /eval/requirements/{requirement_id}`
- `POST /eval/requirements/bulk-delete`
- `GET /eval/requirements/yaml`
- `PUT /eval/requirements/yaml`
- legacy/compatibility endpoints:
  `GET /eval/scenarios`, `GET|PUT /eval/scenarios/{id}/yaml`,
  `POST /eval/scenarios/{id}/run`,
  `POST /eval/scenarios/{id}/lifecycle`,
  `POST /eval/generate-scenario`,
  `POST /eval/scenarios/save-generated`

## Coverage And Requirements

Coverage is now requirements-backed. The source of truth is
`docs/evaluation/requirements.yaml`, not the legacy Markdown matrix. The legacy
`docs/evaluation/COVERAGE_MATRIX.md` may still exist as historical input, but
the admin Coverage view reads the YAML requirements document and the computed
graph returned by `GET /eval/coverage`.

Requirement YAML shape:

```yaml
version: 1
sections:
  - id: init
    title: Init
    requirements:
      - id: INIT-002
        summary: Purchase new init collects listing/address, financing, dump, then initializes.
        priority: p1
        required_evidence:
          - test_type: replay
        legacy_status: Covered
        automated_protection: Cash and financed purchase replays.
        next_action: Add mind-change case.
        labels: [init, purchase]
```

Required fields:

- top-level `sections` list;
- section `id`, `title`, and `requirements`;
- requirement `id` and `summary`.

Optional requirement fields:

- `priority`;
- `required_evidence`, with entries such as `{test_type: replay}`;
- `legacy_status`, retained from the old matrix as context only;
- `automated_protection`;
- `next_action`;
- `labels`.

Tests claim requirements through top-level YAML `covers`:

```yaml
test_type: replay
jira: ACT-flat-cash-happy
covers:
  - INIT-002
  - PUR-NEW-003
```

The coverage graph joins `covers` entries to requirement ids. Unknown ids appear
under `unknown_covers`. Tests without `covers` appear under
`tests_without_covers` and do not protect any requirement.

Computed statuses:

- `missing`: no test claims the requirement;
- `claimed`: at least one test claims it, but passing evidence is absent or
  insufficient;
- `failing`: linked latest run evidence failed;
- `partial`: some required evidence exists but not all required evidence types
  pass;
- `covered`: required evidence is satisfied by passing linked test runs.

`legacy_status` does not drive computed status. Do not mark a requirement
covered by editing `legacy_status`.

Admin UI behavior:

- left rail lists requirement categories from `sections`;
- clicking a category shows only that category's requirements;
- header checkbox selects or clears all requirements in the active category;
- row checkbox selects one requirement for bulk delete;
- clicking a row shows details in the shared right context rail;
- New/Edit use form fields for one requirement;
- Bulk Edit YAML opens the full `requirements.yaml` in a CodeMirror YAML editor;
- raw YAML save uses `expected_hash` and validates shape and duplicate ids;
- Bulk Delete removes selected requirement ids, requiring confirmation/force if
  tests still reference them.

## Catalog Search And Filters

`GET /eval/tests` supports:

- `q`
- `test_type`
- `bucket`
- `runner`
- `lane`
- `status`
- `priority`
- `runnable`
- `editable`
- `sort`
- `page`
- `per_page`

The runner builds a normalized catalog from YAML and runner-owned suite/profile
rows. Search/filtering is internal to `runner_api.py`, not a database query.

## File Explorer Model

The Catalog page now behaves like a file explorer:

- Root is always `simulations/`.
- Users can create arbitrary folders and organize YAML/JSON files as they want.
- Folder location must not be treated as the source of truth for test type.
- YAML `test_type` is preferred, then catalog metadata, YAML shape, and finally
  legacy path fallback.
- Double-clicking a folder opens it; single-clicking a test/snapshot selects it.
- Double-clicking a runnable test runs it.
- Right-click opens row actions.

Explorer item kinds:

- `folder`: a directory under `simulations/`.
- `test`: `.yaml` / `.yml` definition.
- `snapshot`: `.json` fixture used by micro-tests.

File operations:

- Create folder: `POST /eval/files/folders` with `parent_path`, `name`.
- Create snapshot: `POST /eval/files/snapshots` with `parent_path`, `name`.
- Rename: `PATCH /eval/files/rename` with `path`, `name`.
- Move: `PATCH /eval/files/move` with `path`, `destination`.
- Delete: `DELETE /eval/files?path=...&recursive=false`.
- Read/write raw content: `GET|PUT /eval/files/content`.

The file tree response includes reference metadata. Use it before moving or
deleting snapshots or seed scenarios. The frontend warning is advisory; Codex
should still inspect the references and explain the consequence.

## Safe Run Dispatchers

`POST /eval/tests/{test_id}/run` only dispatches known-safe test runners:

- replay + `parallel-replay-runner`
- extraction + `evaluate-extraction` or `eval-suite-golden-extraction`
- microtest + `parallel-micro-runner`
- suite/profile rows

Rows without supported dispatchers remain visible but are not API-runnable.

`POST /eval/tests/bulk-run` accepts `test_ids` plus the normal run options and
creates a parent `test-batch` job. The batch job starts child jobs one at a time
through the same single-test dispatcher, aggregates `run_ids`, exposes
`total_count`, `queued_count`, `completed_count`, `failed_count`,
`canceled_count`, `active_child_job_id`, and supports cancellation through
`POST /eval/jobs/{job_id}/cancel`.

The Catalog UI uses this endpoint for:

- row checkbox selection + `Review Selected`, where `Run All` queues the
  selected runnable tests and `Move All` / `Delete All` reuse the confirmation
  dialogs with reference warnings;
- `Run Folder`, which queues promoted API-runnable tests under the current
  explorer folder recursively and ignores draft/reviewed/repo/candidate tests;
- folder context-menu `Run Folder`.

The promoted-only rule is specific to `Run Folder`. Single-row `Run` and
`Review Selected` -> `Run All` keep using the exact selected runnable tests.

## Definition Editing

Definition read/write uses YAML plus optimistic locking:

- read: `GET /eval/tests/{test_id}/definition`
- save: `PUT /eval/tests/{test_id}/definition` with `expected_hash`

Promoted tests are not overwritten. Saving a promoted definition creates a draft
revision with `qa_status: draft`, `source_trace: manual-draft-revision`, and
`seed_scenario` pointing at the promoted source.

The YAML editor must preserve semantic `test_type`. If a user moves a file into
a different folder, the test type should not change. If YAML `test_type`
contradicts the editor or runner type, the runner should reject the save.

## Snapshots And Linking

Snapshots are JSON state fixtures. They are not runnable on their own. A
micro-test links one snapshot with top-level YAML:

```yaml
test_type: microtest
snapshot: ../snapshots/example.json
```

The `snapshot` path is resolved relative to the micro-test YAML file. When a
snapshot is moved, any linked micro-tests may need path updates. The admin UI
provides Add Snapshot from the right rail/context menu for editable micro-tests;
that action writes/replaces the YAML `snapshot` key and saves the definition.

## Lifecycle

Allowed lifecycle statuses:

- `draft`
- `reviewed`
- `promoted`
- `archived`

Promotion requires reviewed first. Reviewed/promoted transitions require lint
without errors. Archive is a soft lifecycle change, not physical deletion.
