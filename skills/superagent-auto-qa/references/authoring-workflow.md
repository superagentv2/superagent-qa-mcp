# Authoring Workflow

## Decide Test Type

- Use replay when the behavior needs a real agent conversation and tool flow.
- Use extraction when the target is backend extraction accuracy only.
- Use micro-test when the bug is a narrow mid-call state, routing decision, or
  one/few-turn behavior after a known snapshot.
- Use suite/profile when running an existing batch, not when authoring one new
  behavior.

## Choose Replay User Mode

Prefer `user_mode: simulated`. It lets the caller answer the conversation that
actually occurs instead of depending on brittle question substrings.

For simulated mode, author:

- `goal` for the caller's overall objective;
- `field_data` for authoritative values;
- optional intents whose `intent` name explains the purpose and whose
  `original_line` supplies example information to communicate.

The executor supplies both an explicit goal and those intent hints to the
simulated-user LLM. It never supplies `matches_questions`. Do not expect intent
order or exact wording to control a simulated conversation.

Use `user_mode: replay` only when exact caller wording or matcher-anchored
sequencing is part of the behavior under test. In that mode,
`matches_questions` selects the next intent and `original_line` is emitted
verbatim.

## Author Without Codebase Access

The hosted MCP should be sufficient for normal test authoring:

1. Fetch health, manifest, hosted documentation, requirements, and focused
   catalog examples.
2. Take required YAML keys and valid fields, tools, values, assertions, user
   modes, and lifecycle states from those hosted contracts.
3. Supply synthetic test-user data manually when the runner requires it.
4. If an optional internal detail is ambiguous, omit it. Assert another stable,
   observable signal instead of inventing a field, tool, or assertion.
5. Inspect the application code only when the hosted contracts cannot establish
   behavior that is essential to the test and no equivalent oracle exists.

Examples of alternative evidence include captured fields, phase transitions,
known tool calls, agent speech intent, and terminal call behavior.

## Replay Backend And Side Effects

Current hosted MCP/UI replay execution uses the real backend. A `fake_backend`
mapping in YAML supplies fake responses only when the runner is explicitly
started in offline mode; it does not switch a normal hosted replay offline.

Before running a side-effecting replay:

- Establish whether real backend writes and queued actions are accepted.
- Use unique synthetic identities, addresses, and recipient emails. Use a
  designated test mailbox or a non-personal placeholder accepted by backend
  validation; never use a real person's address.
- Keep assertions aligned with scope. A voice-only test should verify voice,
  state, and tool orchestration rather than external provider delivery.
- For a fire-and-forget action, treat successful queueing/acceptance as the
  synchronous behavior. Do not wait for or assert eventual delivery unless
  delivery is explicitly in scope.

For the current send-for-signature voice flow, first verify the exact tool names
through the manifest. The stable terminal sequence is:

1. Require explicit user confirmation before `confirm_and_send_signature`.
2. Assert that the tool is called after confirmation.
3. Assert an immediate sending/queued acknowledgement and the question asking
   whether the user wants to hang up.
4. If the user agrees, assert `end_call`.
5. Do not use delivery-provider success as the oracle for a voice-only replay.

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

The key is optional to YAML execution but operationally expected whenever a
test protects a registered requirement. Fetch the current hosted requirements,
use exact IDs, and include only requirements that the test's assertions prove.
Broad happy-path replays may list multiple requirements, but completing a flow
does not automatically prove every requirement in that flow.

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
- Do not use `matches_questions` to steer simulated mode; the simulated-user
  LLM never receives them.
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
2. For a replay, default to `user_mode: simulated`; use literal replay only
   when exact wording or matcher-anchored sequencing is essential.
3. Fetch the manifest and select a valid `contract_type`.
4. Use manifest field names in `field_data`, `expected_fields`, and
   `forbidden_fields`.
5. Pick a stable deterministic oracle.
6. Set `ai_provider: codex` unless the user explicitly requests `live`.
7. Add readable `title`/`notes`, taxonomy, and exact registered `covers` for
   every requirement the test proves.
8. Save as `qa_status: draft`.
9. Lint before review.
10. Run the narrowest useful proof.
11. Promote only after human/Codex review.

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
