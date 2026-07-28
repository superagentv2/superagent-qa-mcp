# Authoring Workflow

## Decide Test Type

- Use replay when the behavior needs a real agent conversation and tool flow.
- Use extraction when the target is backend extraction accuracy only.
- Use micro-test when the bug is a narrow mid-call state, routing decision, or
  one/few-turn behavior after a known snapshot.
- Use suite/profile when running an existing batch, not when authoring one new
  behavior.

## Manifest Grounding

Before generating or hand-authoring YAML:

1. Fetch `GET /eval/manifest`.
2. Use business schema for contract fields, addendum slugs, contract types, and
   field values derived from latest published pdfMe/backend state.
3. Use runner schema for supported test types, YAML fields, assertion kinds,
   semantic intents, user modes, suites, profiles, and lifecycle states.
4. If the desired field/tool/assertion is absent, do not silently rename it.
   Add review notes or a lint error so a human can decide.

The admin generator is intentionally not a generic LLM call. It builds a
manifest-grounded plan, compiles YAML, and lints before saving.

## Admin Generation Path

Use `POST /eval/generate-scenario-draft` with:

```json
{
  "description": "plain English test request",
  "test_type": "replay",
  "jurisdiction_code": "AZ"
}
```

Supported generation types normalize to:

- `replay`
- `extraction`
- `microtest`

Generated YAML has:

- `qa_status: draft`
- `source_trace: generated-draft`
- `generated_source` metadata
- manifest hash and prompt/version metadata in the response

Then use:

- `POST /eval/validate-scenario-draft`
- `POST /eval/tests/drafts`
- `POST /eval/tests/{test_id}/lifecycle`

## Review And Promote

Review means a human or Codex has inspected the YAML, lint, manifest grounding,
expected behavior, and at least a narrow run or dry-run where appropriate.

Promote means the definition becomes a trusted regression asset. Do not promote
directly from draft; transition `draft -> reviewed -> promoted`.

Promotion should answer:

- What behavior does this protect?
- Which requirements or product areas does it cover?
- Which deterministic assertions decide pass/fail?
- Is it stable enough to run again?
- Is it in the right test type?

## Editing Existing Tests

- Draft/reviewed YAML can be updated in place if lint passes.
- Promoted YAML should not be overwritten from admin. The API creates a draft
  revision instead.
- Archive instead of delete when removing from active QA flow.

## Search Metadata

Ensure new tests include useful metadata:

- `notes`: readable operator explanation
- `area`: product/flow area such as `init`, `cross-flow`, `clauses`, `addenda`
- `kind`: mechanism such as `voice-simulation`, `field-accuracy`, `micro`
- `priority`: numeric display metadata. Use `priority: 0`, `priority: 1`,
  etc. when QA should see `priority: X` in catalog and run views. Legacy
  `p0`/`p1` values are tolerated but ignored by that display.
- `covers`: requirement IDs from `docs/evaluation/requirements.yaml`
- `ai_provider`: set `codex` for every new or edited QA test. Use `live` only
  when the user explicitly requests the Live API path; do not omit the field,
  because omission selects the backend's Live API default.

These values feed catalog search/filtering and the right-side context rail.

## Requirements And Coverage

Requirements live in `docs/evaluation/requirements.yaml`. That file is the
source of truth for Coverage & Requirements in `/admin/qa`.

The root YAML has a `sections` list. Each section is a category in the Coverage
UI. Each requirement row has at least:

```yaml
id: INIT-002
summary: Purchase new init collects listing/address, financing, dump, then initializes.
```

Optional fields include `priority`, `required_evidence`, `legacy_status`,
`detailed_description`, `next_action`, and `labels`. `detailed_description`
is narrative requirement context only; it does not establish coverage.

Tests claim coverage with top-level `covers`:

```yaml
covers:
  - INIT-002
  - PUR-NEW-003
```

Coverage status is computed by `scripts/qa_coverage_system.py` from
requirements, test claims, and latest run evidence:

- `missing`: no test claims the requirement;
- `claimed`: tests claim it but passing evidence is absent or insufficient;
- `failing`: linked latest run evidence failed;
- `partial`: not all required evidence types pass;
- `covered`: required evidence is satisfied by passing linked runs.

Only test `covers` claims and their linked run evidence determine coverage;
requirement narrative is not coverage evidence.

Do not edit `legacy_status` to fake coverage. It is historical context from the
old matrix and does not drive computed status.

Before creating a new requirement id, inspect `docs/evaluation/requirements.yaml`
and reuse the existing section/category pattern. Before adding `covers` to a
test, verify that the requirement id exists. Unknown ids appear in the admin UI
under unknown covers.

## Authoring Anti-Patterns

- Do not create a test with no oracle.
- Do not invent field names outside the manifest.
- Do not use literal replay when simulated mode would be more stable.
- Do not promote generated YAML without review.
- Do not treat `claimed` as `covered`; run evidence must support the claim.
- Do not relax `bug_signature` or expected fields just to get a pass.

## Full Manifest Script

When Codex is asked to write tests directly, use the full manifest script before
choosing field names or assertions:

```bash
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_manifest.py --root . --out /tmp/qa-manifest.json
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_manifest.py --root . --require-business-schema --out /tmp/qa-manifest.json
```

Default mode tries the running QA runner at `http://localhost:8090`, then falls
back to importing `runner_api.py` locally. Use `--source api` to require the
running runner or `--source local` to force local import.

The script loads project env files before deciding runner/backend URLs:
explicit `--env-file` values first, then agent `.env.local`, `.env.dev`,
`.env`, frontend `.env`, and backend `.env`. Already-exported shell variables
win. Backend manifest URL precedence is `QA_BUSINESS_MANIFEST_URL`,
`TEST_BACKEND_URL`, `BACKEND_URL`, then `NEXT_PUBLIC_API_BASE_URL`.

The output is the full composed JSON from `/eval/manifest`: runner schema plus
the backend business manifest response. The backend part includes active
templates, latest `PUBLISHED` versions, and transformed pdfMe field definitions.
Use `--require-business-schema` when authoring tests so Codex fails fast instead
of accidentally relying on fallback fields.

## Documentation Discovery

Use the docs script when a Codex session needs to learn the QA system before
editing:

```bash
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_docs.py --root . --list
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_docs.py --root . --out /tmp/superagent-qa-docs.md
```

The bundle includes the skill references, canonical repo docs, and the in-app
QA docs source from the frontend. Load only the relevant slices into context
after listing paths; use a bundle when a future MCP/session needs portable
documentation outside the repo.

## Current Test Inventory

Use the catalog script to understand what exists now:

```bash
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_catalog.py --root .
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_catalog.py --root . --json --out /tmp/qa-catalog.json
.venv/bin/python .agents/skills/superagent-auto-qa/scripts/qa_catalog.py --root . --type microtest
```

The script classifies tests the same way Codex should reason:

1. Explicit YAML `test_type`.
2. YAML shape.
3. Legacy path fallback.

Use this to find missing `test_type`, snapshots, references, lifecycle status,
coverage tags, and stale/malformed YAML.

## Hand-Authoring Checklist

1. Choose `test_type` from the behavior being tested, not the target folder.
2. Fetch the manifest and select a valid `contract_type`.
3. Use manifest field names in `field_data`, `expected_fields`, and
   `forbidden_fields`.
4. Pick a stable deterministic oracle.
5. Set `ai_provider: codex` unless the user explicitly requests `live`.
6. Add readable `title`/`notes`, taxonomy, and `covers` where known.
7. Save as `qa_status: draft`.
8. Lint before review.
9. Run the narrowest useful proof.
10. Promote only after human/Codex review.

## CRUD And Linking Checklist

- Create new YAML with `POST /eval/tests/drafts` or by writing a file that
  includes `test_type` and valid schema.
- Edit YAML through `GET|PUT /eval/tests/{test_id}/definition` when testing
  admin behavior; use file edits for repo maintenance.
- Rename/move/delete through `/eval/files/*` when testing the explorer.
- Before moving/deleting a snapshot, inspect `referenced_by` from
  `GET /eval/files/tree`.
- When linking a snapshot to a micro-test, update the top-level `snapshot` key
  with a relative path from the micro-test YAML folder.
- After linking or moving, lint and run the micro-test because JSON shape alone
  does not prove snapshot compatibility.
