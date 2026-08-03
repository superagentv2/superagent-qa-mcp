---
name: superagent-auto-qa
description: "Use when working with SuperAgent automation QA through Codex: understanding the QA system, inspecting manifests, authoring or reviewing replay/extraction/microtest definitions and snapshot bundles, managing catalog files, lifecycle, linting, runs, jobs, coverage, requirements, or using the SuperAgent QA MCP tools."
---

# SuperAgent Auto QA

## Purpose

SuperAgent automation QA is the test system for the SuperAgent voice and
contract workflow. It covers generated/user-authored scenarios, narrow
micro-tests, backend extraction fixtures, run history, requirements coverage,
and lifecycle review before tests are treated as trusted.

When this plugin is installed, assume Codex may not have the SuperAgent
codebase. Use the MCP tools as the primary control surface. Do not invent field
names, tool names, assertion kinds, contract fields, lifecycle states, paths, or
runner commands when the MCP manifest and catalog can tell you.

## First Moves

For any non-trivial QA task:

1. Call `qa_health_get` to confirm the QA runner is reachable.
2. Call `qa_manifest_get` before choosing contract fields, tool names,
   assertion kinds, templates, addenda, suites, or lifecycle values.
3. Prefer `qa_catalog_search` for catalog discovery. Use filters/search terms
   whenever possible instead of fetching the whole catalog.
4. Use `qa_files_tree_get` when the task is about folder/file structure,
   snapshots, moves, deletes, or references. For a managed snapshot, use its
   returned `bundle_id` with `qa_snapshot_bundle_get` rather than treating the
   JSON artifact as the whole object.
5. Use `qa_catalog_get` only when a truly full normalized catalog snapshot is
   needed. Expect it to be slow: it returns the entire catalog payload, currently
   large, and latency will increase as hosted QA accumulates more tests.
6. Read definitions with `qa_definition_get` or raw files with
   `qa_file_content_get`.
7. Before saving a test definition, lint with `qa_lint_definition`. For a
   snapshot recipe, use `qa_snapshot_recipe_validate` and require
   `save_allowed: true` before generation.
8. For writes, preserve optimistic locks such as `expectedHash` when the API
   returns one.
9. Requirement write tools intentionally use lightweight writes: they save the
   requirements document and return the updated requirements/hash without
   recomputing full coverage. Call `qa_coverage_get` separately only when the
   coverage graph is needed.

## Mental Model

- **Definition**: YAML or runner-owned configuration describing a test.
- **Run**: one execution of a definition, suite, or profile. Snapshot generation
  also records a diagnostic run, but the recipe is not itself a catalog test.
- **Assertion/oracle**: the concrete pass/fail check.
- **Manifest**: vocabulary source for contract types, fields, tools,
  assertions, addenda, lifecycle values, suites, profiles, and generation
  constraints.
- **Catalog**: normalized view over tests, files, metadata, lifecycle,
  editability, runnability, references, and latest run status.
- **Snapshot bundle**: one logical fixture composed of a hidden replay recipe,
  optional generated JSON artifact, generation metadata, and references from
  consuming micro-tests.
- **Snapshot recipe**: the replay and declarative capture gate that generate a
  snapshot. It is the source of truth, infrastructure rather than a runnable QA
  test, and excluded from normal catalog, coverage, playlist, and run actions.
- **Snapshot artifact**: generated JSON runtime state consumed by micro-tests;
  it may not exist until the first successful generation.
- **Capture gate**: an `active_task` matcher, timeline `after` matcher, or both;
  capture occurs at the end of the matching turn.

## Test Types

Prefer explicit YAML `test_type` for new and edited tests:

```yaml
test_type: replay      # replay | extraction | microtest
```

Folder path is organization, not identity. QA users can arrange files under
`simulations/`; test type must come from explicit metadata or catalog semantics,
not only from folder names.

- **Replay**: runs the voice agent through a simulated or literal conversation.
- **Extraction**: checks backend extraction behavior without the voice loop.
- **Microtest**: resumes from a snapshot JSON, injects turns, and asserts a
  narrow behavior.

### Replay User Driver Policy

Default authored replays to:

```yaml
user_mode: simulated
```

Simulated mode gives the caller LLM the scenario `goal`, `field_data`, and each
intent's `intent` name plus `original_line` as semantic conversation hints. It
does not expose `matches_questions` to that LLM. The hints guide what the caller
should communicate when relevant; they are not an ordered or literal script.

Use `user_mode: replay` only when exact caller wording or matcher-anchored
sequencing is itself required by the test. Literal replay consumes
`matches_questions` to select an intent and emits its `original_line` verbatim.

## QA AI Provider Policy

For every new or edited QA test definition or snapshot recipe, set:

```yaml
ai_provider: codex
```

`codex` was built specifically for QA tests and is the mandatory default. Use
`ai_provider: live` only when the user explicitly requests the Live API path.
Never omit the key when authoring QA tests or recipes: an omitted value uses the
backend's Live API default. `openai` is not a valid QA value.

## Common Workflows

**Author or generate a test**

1. `qa_manifest_get`
2. `qa_draft_generate` or draft YAML manually from manifest vocabulary
3. `qa_lint_definition`
4. `qa_draft_create`
5. Review, then lifecycle tools only after lint is clean

For replay or extraction tests that assert contract fields, also load
`../superagent-admin-db/SKILL.md` and use its read-only workflow to inspect the
active published template, field configuration, and relevant selected-user
prefills. Classify each assertion as initial/prefilled, newly captured, or
final before writing YAML. Never infer emptiness, capture timing, or canonical
storage format. Lint and inspect one calibration run before review. See
`references/authoring-workflow.md` for the compact procedure.

**Edit an existing test**

1. `qa_catalog_search`
2. `qa_definition_get`
3. Make a narrow YAML change
4. `qa_lint_definition`
5. `qa_definition_save` with `expectedHash`

**Run and triage**

1. `qa_test_run`, `qa_tests_bulk_run`, `qa_suite_run`, or `qa_profile_run`
2. Poll with `qa_job_get` / `qa_jobs_list`
3. Inspect `qa_runs_list`, `qa_run_get`, and `qa_run_markdown_get`

**Create or regenerate a snapshot bundle**

1. Call `qa_files_tree_get` to choose a simulations folder or discover an
   existing snapshot's `bundle_id` and consumers.
2. For a new fixture, call `qa_snapshot_bundle_create`. It creates a draft
   recipe and deliberately does not manufacture placeholder JSON.
3. Edit the returned recipe YAML without changing `recipe_type`, `bundle_id`,
   or `snapshot_path`. Set `ai_provider: codex` unless Live was explicitly
   requested, and use a real user in the target backend environment.
4. Call `qa_snapshot_recipe_validate`. `valid` reports structural parsing;
   require `save_allowed: true` and review all diagnostics before generation.
5. Call `qa_snapshot_recipe_save` with the latest recipe `expectedHash`.
6. Call `qa_snapshot_generate`, then poll its returned job with `qa_job_get`.
   Use `qa_job_cancel` only when cancellation is requested.
7. After a terminal job status, call `qa_snapshot_bundle_get`. Success requires
   `generation_status: ready` and `artifact_available: true`.
8. If generation fails, inspect job events/error and the saved generation
   `run_id` when available. The previous working artifact remains untouched.
9. Link the generated artifact from a micro-test using a path relative to that
   micro-test YAML, then lint and run the consuming micro-test.

When the user explicitly requests a manual artifact instead of generation,
call `qa_snapshot_artifact_save` with a complete runtime snapshot JSON object.
This works for a pending bundle with no artifact and for an existing artifact,
validates the runtime Snapshot model, and marks the bundle `manually_modified`.
Fetch the bundle first and pass its `snapshot_hash` as `expectedHash` when an
artifact already exists. Generation remains the preferred reproducible path and
will replace the manual artifact after confirmation.

Bundle statuses are `never_generated`, `generating`, `ready`, `stale`,
`generation_failed`, and `manually_modified`; unmanaged existing JSON is
`legacy`. A stale bundle needs regeneration. Use `qa_snapshot_artifact_save`
for explicit managed-bundle overrides because it validates the runtime model.
Raw edits through `qa_file_content_save` remain a lower-level escape hatch for
existing files and may bypass runtime-model validation. Either form of manual
editing is overwritten by regeneration; warn before using it.

Use `qa_files_tree_get` before operations that affect references. Rename is
coordinated: the runner remaps descendant paths, YAML `snapshot`/`seed_scenario`
references, managed bundle artifact paths, and path-based playlist IDs. Move and
delete are not yet bundle-aware, so do not use them on managed bundle artifacts.
For legacy snapshots, inspect and report all consumers before any move or
deletion.

**Catalog discovery**

Use `qa_catalog_search` first. It is the normal tool for finding tests by text,
type, lifecycle, result, priority, path, or metadata. Avoid `qa_catalog_get` for
interactive discovery because it fetches every normalized row. If a user asks
for the entire catalog, warn that the call can be slow and may approach or
exceed client timeouts as the catalog grows.

**Requirements and coverage**

Use `qa_requirements_get` to inspect the requirements document and
`qa_coverage_get` to compute the heavier coverage graph. Create/update/delete
requirement tools use the runner's `include_coverage=false` mode by default, so
they should not be followed by `qa_coverage_get` unless the user specifically
needs refreshed coverage.

`covers` is optional to the YAML schema but expected on authored tests that
protect registered requirements. Refresh the hosted requirements first, use
exact requirement IDs, and claim only behavior that the test's assertions
actually prove. A full-flow replay may cover multiple requirements.

## Field Assertion Polarity

`expected_fields` and `forbidden_fields` use the same matchers with opposite
outcomes:

- `expected_fields`: the inner matcher must match.
- `forbidden_fields`: the inner matcher must not match; a match fails the
  assertion.

Do not copy `empty: true` into `forbidden_fields` to mean "must be empty or
absent." It means emptiness is forbidden and fails when the field is missing,
because missing is treated as empty. Prefer this explicit form:

```yaml
expected_fields:
  agreement_commencement_date:
    empty: true
```

To forbid any populated value, use `not_empty: true` under
`forbidden_fields`. To forbid one known bad value, use `equals` or `contains`
under `forbidden_fields`. See `references/test-types-and-yaml.md` for the full
truth table and examples.

## Assertion Pass-Rate Policy

Use optional `min_pass_rate` on an individual timeline or final assertion when
repeated runs may tolerate limited variation. It defaults to `1.0` and must be
an unquoted number greater than `0` and at most `1`. The launch or playlist
configuration controls how many times the test runs; `min_pass_rate` controls
how many of those attempts that assertion must pass.

Apply it at the assertion entry for `timeline_assertions` and `bug_signature`,
inside a field expectation for `expected_fields`, `forbidden_fields`, or
`expected_prefilled_fields`, and on an `extract_turns` entry that has
`expected_newly_captured`. Give authored `bug_signature` entries an `id`, and
give thresholded extraction-turn assertions an `assertion_id`, so results have
stable names across runs. See `references/test-types-and-yaml.md` for examples.

## Advisory Assertion Policy

Assertions are blocking by default. Use `blocking: false` only when the user
explicitly wants an observation recorded without letting its failure decide the
test outcome. Advisory assertions still run, appear in artifacts and Run Studio,
and retain their per-run and repeated-run pass rates.

The key is supported on `timeline_assertions` and `bug_signature` entries;
inside `expected_fields`, `forbidden_fields`, and
`expected_prefilled_fields` expectations; and on an `extract_turns` entry with
`expected_newly_captured`. It must be an unquoted boolean. Keep at least one
blocking deterministic oracle in every reviewed or promoted test. Never change
an assertion to advisory merely to obtain a passing result.

## Safety Rules

- Never promote generated YAML without human review.
- Do not weaken assertions just to make a run pass.
- Do not guess pdfMe/contract field names; fetch the manifest.
- Replay and extraction `user_id` values must identify a real user in the
  target backend environment. Never invent or retain a draft placeholder.
- Snapshot recipes also require a real target-environment user. Never create a
  fake JSON shell; create a pending bundle and generate its artifact.
- Do not manually edit generated snapshot JSON unless the user explicitly
  requests advanced artifact editing and accepts that regeneration replaces it.
- Do not directly mutate files outside the QA MCP/file APIs unless the user
  explicitly asks for local repo edits.
- Treat `QA_RUNNER_TOKEN` as server-only. Admin users should normally provide
  only `MCP_TOKEN`.

## References

Load only the reference needed:

- `references/test-types-and-yaml.md`: YAML shape, metadata, snapshot recipe
  schema/capture targets/statuses, assertions, and test-type differences.
- `references/authoring-workflow.md`: authoring without codebase access,
  database-grounded contract authoring, replay backend/side-effect policy,
  snapshot generation/linking, review, promotion, and anti-patterns.
- `references/admin-ui-contract.md`: admin QA UI/API semantics, catalog,
  filters, CRUD, lifecycle, explorer behavior, and Snapshot Workbench.
- `references/runbook.md`: running tests, artifacts, runner activation, and
  safe run/snapshot-generation choices and failure triage.
- `references/source-map.md`: local code/documentation source map for sessions
  that also have the SuperAgent repositories.

Some references mention local scripts from the agent repository. In plugin/MCP
mode, prefer the MCP tools first. Use local scripts only when the user’s session
actually has the relevant repository and asks for repo-local work.
