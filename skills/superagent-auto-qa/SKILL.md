---
name: superagent-auto-qa
description: "Use when working with SuperAgent automation QA through Codex: understanding the QA system, inspecting manifests, authoring or reviewing replay/extraction/microtest definitions, managing catalog files, lifecycle, linting, runs, jobs, coverage, requirements, or using the SuperAgent QA MCP tools."
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
   snapshots, moves, deletes, or references.
5. Use `qa_catalog_get` only when a truly full normalized catalog snapshot is
   needed. Expect it to be slow: it returns the entire catalog payload, currently
   large, and latency will increase as hosted QA accumulates more tests.
6. Read definitions with `qa_definition_get` or raw files with
   `qa_file_content_get`.
7. Before saving, lint with `qa_lint_definition`.
8. For writes, preserve optimistic locks such as `expectedHash` when the API
   returns one.
9. Requirement write tools intentionally use lightweight writes: they save the
   requirements document and return the updated requirements/hash without
   recomputing full coverage. Call `qa_coverage_get` separately only when the
   coverage graph is needed.

## Mental Model

- **Definition**: YAML or runner-owned configuration describing a test.
- **Run**: one execution of a definition, suite, or profile.
- **Assertion/oracle**: the concrete pass/fail check.
- **Manifest**: vocabulary source for contract types, fields, tools,
  assertions, addenda, lifecycle values, suites, profiles, and generation
  constraints.
- **Catalog**: normalized view over tests, files, metadata, lifecycle,
  editability, runnability, references, and latest run status.
- **Snapshot**: JSON state fixture used by micro-tests; not itself runnable.

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

For every new or edited QA test definition, set:

```yaml
ai_provider: codex
```

`codex` was built specifically for QA tests and is the mandatory default. Use
`ai_provider: live` only when the user explicitly requests the Live API path.
Never omit the key when authoring QA tests: an omitted value uses the backend's
Live API default. `openai` is not a valid QA test value.

## Common Workflows

**Author or generate a test**

1. `qa_manifest_get`
2. `qa_draft_generate` or draft YAML manually from manifest vocabulary
3. `qa_lint_definition`
4. `qa_draft_create`
5. Review, then lifecycle tools only after lint is clean

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

**Manage files and snapshots**

Use `qa_files_tree_get` before moving or deleting. Snapshot paths may be
referenced from micro-test YAML. If deleting or moving a referenced file,
inspect references and report the impact before making the change.

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

## Safety Rules

- Never promote generated YAML without human review.
- Do not weaken assertions just to make a run pass.
- Do not guess pdfMe/contract field names; fetch the manifest.
- Do not directly mutate files outside the QA MCP/file APIs unless the user
  explicitly asks for local repo edits.
- Treat `QA_RUNNER_TOKEN` as server-only. Admin users should normally provide
  only `MCP_TOKEN`.

## References

Load only the reference needed:

- `references/test-types-and-yaml.md`: YAML shape, metadata, snapshots,
  assertions, and test-type differences.
- `references/authoring-workflow.md`: authoring without codebase access,
  replay backend/side-effect policy, generation, review, promotion, and
  anti-patterns.
- `references/admin-ui-contract.md`: admin QA UI/API semantics, catalog,
  filters, CRUD, lifecycle, and explorer behavior.
- `references/runbook.md`: running tests, artifacts, runner activation, and
  safe run choices.
- `references/source-map.md`: local code/documentation source map for sessions
  that also have the SuperAgent repositories.

Some references mention local scripts from the agent repository. In plugin/MCP
mode, prefer the MCP tools first. Use local scripts only when the user’s session
actually has the relevant repository and asks for repo-local work.
