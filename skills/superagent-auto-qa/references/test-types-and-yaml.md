# Test Types And YAML

## Admin UI Test Types

The `/admin/qa` workbench centers on these normalized catalog test types:

- `E2E`: fresh or snapshot-backed voice-agent regression scenarios.
- `extraction`: isolated backend extraction fixtures.
- `microtest`: snapshot resume tests.
- `suite`: curated eval suites from `evaluate.py eval-suite`.
- `profile`: profile wrappers such as PR/nightly/release from `EVAL_PROFILES`.
- `legacy-simulation`: visible in catalog for ownership/visibility, usually not
  editable or API-runnable.

Full browser-driven E2E is documented but intentionally not the first admin UI
surface.

## Type Classification

New and edited YAML definitions should declare their semantic type explicitly:

```yaml
test_type: e2e      # e2e | extraction | microtest
```

The filesystem path is now an organization choice, not the source of truth. QA
users can create folders under `simulations/` and organize tests however they
prefer. The runner classifies definitions in this order:

1. Explicit YAML `test_type`.
2. Existing catalog/runner metadata for known rows.
3. YAML shape fallback: `user_turns`/`checks` implies `microtest`;
   `init_transcript`/`extract_turns` implies `extraction`.
4. Legacy path fallback only.

Do not rely on folder names to decide test behavior. Moving a micro-test into a
team folder must not turn it into an E2E. If `test_type` contradicts the
editor or runner type, the admin API should reject the save or lifecycle change.

## Shared Metadata

Prefer these metadata fields on new or migrated definitions:

```yaml
test_type: e2e      # e2e | extraction | microtest
qa_status: draft        # draft | reviewed | promoted | archived
source_trace: manual-draft
jira: QA-SHORT-ID       # E2E and microtest
id: QA-SHORT-ID         # extraction
authored_by: qa-admin
notes: Human-readable intent and review notes.
area: [cross-flow]
kind: [voice-simulation]
priority: 1
covers: [PUR-NEW-002]
ai_provider: codex
```

`qa_status` powers lifecycle. `area`, `kind`, `priority`, and `covers` power
catalog filtering/search and side-panel context. Numeric test priorities are
displayed as `priority: X` in the admin catalog and run views. Legacy values
such as `p0`/`p1` are tolerated but ignored by that display.

`ai_provider: codex` is mandatory for new and edited QA tests. It uses the
QA-specific Codex extraction path. Use `ai_provider: live` only when the user
explicitly requests the Live API path. Do not omit the field: omission selects
the backend's Live API default. `openai` is not a valid value.

## E2E Regression YAML

Schema source: `core/testing/e2e_scenario.py::E2EScenario`.

Important fields:

```yaml
test_type: e2e
source_trace: evaluation-plan
qa_status: draft
jira: ACT-example
authored_by: qa-admin
notes: What this scenario protects.
contract_type: purchase
mode: New
mode_style: fast
ai_provider: codex
user_id: REPLACE_WITH_VALID_USER_ID
is_guest: false
tier: 3
user_mode: simulated
user_style: natural
goal: Create a purchase contract and answer the assistant naturally.
area: [cross-flow]
kind: [voice-simulation]
priority: 1
covers: [PUR-NEW-002]
field_data:
  purchase_price: 700000
intents:
  - intent: provide_purchase_price
    original_line: The purchase price is 700,000 dollars.
bug_signature:
  - kind: agent_did_not_ask_answered_field
    field: purchase_price
    matches_questions:
      - purchase price
timeline_assertions:
  - id: price-not-reasked-after-capture
    description: The agent does not ask for purchase price after it is captured
    after:
      event: field_captured
      field: purchase_price
    forbid:
      event: agent_said
      contains: purchase price
expected_fields:
  purchase_price:
    equals: 700000
max_turns: 60
```

Use `user_mode: simulated` unless exact phrasing matters. Use
`user_mode: scripted` only for literal transcript/utterance-sensitive paths.

In simulated mode:

- `goal` is the caller's primary objective.
- `field_data` is the caller's authoritative source of factual values.
- Every intent's `intent` name and `original_line` are appended to the goal as
  semantic conversation hints, even when the YAML already provides an explicit
  `goal`.
- Intent hints are not an ordered script. The caller should use them only when
  contextually relevant, avoid forcing them into unrelated turns, and avoid
  repeating information already communicated.
- `matches_questions` is never provided to the simulated-user LLM.

In scripted execution mode, the executor uses `matches_questions` to select an
intent and emits its `original_line` verbatim. Include matcher phrases only
when `user_mode: scripted` needs them; omit them from simulated-mode definitions
unless the same fixture intentionally supports scripted execution as well.

An E2E starts a fresh conversation by default. To continue from known
mid-call state while exercising the real voice-agent loop, tools, and backend,
add a generated snapshot:

```yaml
test_type: e2e
contract_type: purchase
mode: Edit
mode_style: fast
ai_provider: codex
user_id: user_real_target_environment_id
snapshot: ../snapshots/purchase-review-ready.json
```

The path is relative to the E2E YAML. Checkpoint E2E requires a
version 3 artifact with `backend_state`; versions 1 and 2 remain valid only for
offline microtests. The E2E and checkpoint must match on `user_id`,
`contract_type`, `mode`, and `mode_style`. `snapshot` and `seed_scenario` are
mutually exclusive because both define initial state. Use a micro-test instead
when fast offline behavior is the intended subject.

Do not assume that adding `fake_backend` to E2E YAML activates offline
execution. In the current hosted MCP/UI execution path, E2E tests use the real
backend; fake-backend configuration is consumed only when the runner is
explicitly started in offline mode. Treat real backend writes and queued
external actions as intentional side effects when reviewing an E2E.

## Extraction Fixture YAML

Schema source: `core/testing/extraction_scenario.py::ExtractionScenario`.

```yaml
test_type: extraction
qa_status: draft
id: EXT-example
notes: Verifies cash purchase extraction from init transcript.
area: [extraction]
kind: [field-accuracy]
priority: 1
covers: [PUR-NEW-002]
contract_type: purchase
mode: New
mode_style: fast
ai_provider: codex
user_id: REPLACE_WITH_VALID_USER_ID
init_transcript:
  - "user: Cash purchase for 700,000 dollars."
extract_turns:
  - segments:
      - "user: Close of escrow is June 15, 2026."
    expected_newly_captured: [close_of_escrow]
expected_fields:
  purchase_price:
    equals: 700000
forbidden_fields: {}
```

Use extraction fixtures when testing backend extraction only. They do not test
voice-agent routing, conversation policy, or tool orchestration.

For E2E and extraction tests, replace `REPLACE_WITH_VALID_USER_ID` with a
real user ID from the backend environment where the test will run. Draft lint
checks the ID through the backend QA validation endpoint. A missing user is a
blocking lint error; an unavailable validation service is a warning while
editing, but execution preflight still refuses to start because an unverified
identity cannot initialize reliable contract state. Guest-mode scenarios do
not require this lookup.

### Extraction state boundaries

Treat extraction as three separate states: initial/prefilled state, the fields
captured by one turn, and final accumulated state.

- Use `expected_prefilled_fields` for template or selected-user state present
  before the extraction turn.
- Use `expected_newly_captured` only for fields that were absent initially and
  were captured from that specific turn.
- Use `expected_fields` for the required final accumulated state.
- Use `forbidden_fields` for a specific invalid value or cross-field leak, not
  to blanket unrelated or profile-backed fields as empty.

```yaml
expected_prefilled_fields:
  broker_address:
    not_empty: true

extract_turns:
  - segments:
      - "user: The buyer address is 123 Test Street, Phoenix, Arizona 85001."
    expected_newly_captured: [buyer_address, buyer_city, buyer_state, buyer_zip]

expected_fields:
  buyer_address:
    equals: 123 Test Street
  buyer_city:
    equals_any: [Phoenix, phoenix]

forbidden_fields:
  broker_address:
    equals: 123 Test Street
```

This example proves that the prefilled broker address survives, the buyer
address components are captured by the current turn, and buyer data does not
leak into the broker field. Confirm every field name and initial-state
assumption from the manifest and read-only database evidence before using this
pattern.

## Micro-Test YAML

Schema source: `core/testing/e2e_scenario.py::MicroTestFixture`.

```yaml
test_type: microtest
qa_status: draft
jira: MICRO-example
notes: Resume after addendum routing and verify no repeated question.
area: [addenda]
kind: [micro]
priority: 1
ai_provider: codex
snapshot: snapshots/example-state.json
user_turns:
  - "Yes, add that addendum."
bug_signature:
  - kind: agent_did_not_ask_answered_field
    field: seller_compensation
    matches_questions:
      - seller compensation
timeline_assertions:
  - id: no-reask-after-answer
    description: Seller compensation is not requested again after the answer
    after:
      event: user_said
      contains: add that addendum
    forbid:
      event: agent_said
      contains: seller compensation
fake_backend: {}
```

Generated micro-tests must reference an approved existing snapshot. Managed
snapshot JSON normally comes from a snapshot recipe and is read-only by default
in the browser. Advanced editing can also create an artifact for a pending
bundle without generation. Manual saves validate the runtime Snapshot model,
mark the bundle manually modified, and remain an exceptional authoring path.

## Snapshot Bundle Recipe YAML

A managed snapshot is a bundle containing a hidden snapshot recipe, its generated
JSON artifact, generation metadata, and references from consuming E2E tests or
micro-tests.
The recipe is the source of truth; the JSON is a replaceable build artifact.
Recipes are infrastructure, not runnable QA tests, and do not participate in
catalog test lists, coverage, playlists, or lifecycle promotion.

The bundle API creates and owns `recipe_type`, `bundle_id`, and
`snapshot_path`. Preserve them exactly when editing:

```yaml
recipe_type: snapshot
bundle_id: 6c924f2231f84555a3b1de067d1017fb
snapshot_path: simulations/snapshots/purchase-after-area.json
snapshot_capture:
  active_task:
    kind: FlatTask
    identifier: flat
  after:
    event: field_captured
    field: geographical_area
  capture_at: end_of_turn

test_type: e2e
qa_status: draft
jira: SNAPSHOT-PURCHASE-AFTER-AREA
title: Purchase state after geographical area
notes: Generates a reusable state fixture after the target field is captured.
source_trace: snapshot-recipe
contract_type: purchase
mode: New
mode_style: fast
ai_provider: codex
user_id: user_real_target_environment_id
user_mode: simulated
goal: |
  Start a new purchase contract and provide the requested geographical area.
field_data:
  geographical_area: Maricopa County, Arizona
intents: []
bug_signature: []
timeline_assertions: []
max_turns: 40
```

`snapshot_capture` requires `active_task`, `after`, or both:

- `active_task` waits for a resumable runtime task/agent state.
- `after` reuses the timeline event matcher vocabulary and waits for matching
  runtime evidence.
- Combining both requires the event and active runtime state to agree.
- `capture_at` currently only accepts `end_of_turn`: the triggering turn is
  allowed to complete, then the resulting runtime state is captured and E2E
  stops.

Supported `active_task.kind` values are:

- `AddendumTask`, `FlatAddendumTask`, `SectionTask`, `FlatTask`, and
  `WorkspaceTask`.
- `ClauseReviewTask`.
- `FillingAgent`, limited to resumable post-section states such as edit or
  completion menus.
- `ReviewAgent` while awaiting input, awaiting confirmation, or in its stable
  failed state; never while review delivery is active.
- `SignatureAgent` only before sending while awaiting input or confirmation;
  never while signature delivery is active.

`InitAgent` and other unsupported runtime kinds cannot be snapshot targets.
Addendum, section, and workspace task snapshots require a meaningful task
identifier; task snapshots that resume schema-driven work require cached schema
state.

Before replacing an artifact, generation validates the current Snapshot model,
rejects fatal backend initialization failures, and requires non-empty runtime
state including `user_id`, `contract_type`, `mode`, `post_init_prompt`,
`document_id`, `deal_id`, and `section_order`. The candidate is written to a
temporary path and atomically replaces the prior JSON only after validation.
Failure therefore leaves the previous working artifact untouched.

New generated artifacts use `format_version: 3`. Alongside reconstructable
agent/task state, they include `backend_state`, a restricted seed for cloning
the captured deal, document, and workflow graph into a fresh isolated room.
Checkpoint E2E hydrates that graph during PREPARE, initializes extraction in
Edit mode, remaps identifiers, restores chat/task state without a cold opener,
and emits `checkpoint_restored` before normal execution. The source checkpoint is
never mutated. Execution after resume remains a real backend run and may cause
permitted test-environment side effects; microtests keep their existing offline
runtime.

Bundle status meanings:

| Status | Meaning |
| --- | --- |
| `legacy` | Existing unmanaged JSON without a snapshot recipe. |
| `never_generated` | Recipe exists, but no successful artifact exists yet. |
| `generating` | A generation job is queued or running. |
| `ready` | Artifact matches its recipe and recorded environment metadata. |
| `stale` | Recipe, deployment, or manifest changed since generation. |
| `generation_failed` | The latest generation attempt failed. |
| `manually_modified` | Artifact was created manually or differs from the generated hash. |

## Assertions

Assertions are the oracle: the concrete checks that decide pass/fail.

Use:

- `expected_fields` / `forbidden_fields` for backend field-state gates.
- `bug_signature` for semantic behavior checks.
- `timeline_assertions` when ordering matters or the same evidence may appear
  elsewhere in the conversation.
- extraction `expected_fields` and `expected_newly_captured` for extraction.
- tool-call assertions when the behavior is observable as a tool call.

### Alternative expected agent responses

Use `agent_said_after_user` when the response must occur after a matching user
turn. Its legacy `text` matcher accepts one required substring. When either of
several stable phrasings is acceptable, use `any_of` instead. The assertion
passes when at least one listed phrase appears in the agent messages after the
anchored user turn and before the next user turn:

```yaml
bug_signature:
  - id: signature-confirmation-after-request
    kind: agent_said_after_user
    before: send it for signature
    any_of:
      - confirm the signer details
      - ready to send for signature
```

`text` and `any_of` are mutually exclusive. `any_of` must be a non-empty list
of non-empty strings. Multiple separate bug signatures are AND assertions; use
one `any_of` entry when the intended relationship is OR.

### Expected versus forbidden field assertions

Both containers use the same inner matchers, but their polarity is opposite:

| Container | When the inner matcher matches | Assertion result |
| --- | --- | --- |
| `expected_fields` | The expected state was observed | Pass |
| `forbidden_fields` | The forbidden state was observed | Fail |

The runner evaluates the field matcher first and negates that result for
`forbidden_fields`. Consequently, do not mechanically reuse an
`expected_fields` matcher under `forbidden_fields`.

Canonical forms:

```yaml
# The field must be empty or absent. This is the clearest form.
expected_fields:
  agreement_commencement_date:
    empty: true

# Equivalent outcome expressed as a forbidden populated state.
forbidden_fields:
  agreement_commencement_date:
    not_empty: true

# One specific stale or incorrect value must not survive.
forbidden_fields:
  acceptance_date:
    contains: "17:00"
```

Field-state outcomes:

| Definition | Missing or empty field | Non-empty field |
| --- | --- | --- |
| `expected_fields: {field: {empty: true}}` | Pass | Fail |
| `forbidden_fields: {field: {not_empty: true}}` | Pass | Fail |
| `forbidden_fields: {field: {empty: true}}` | **Fail** | Pass |

`empty: true` treats a missing field as empty. Therefore, the diagnostic
`forbidden expectation matched: missing treated as empty` means the inner
`empty` matcher succeeded and `forbidden_fields` then converted that match into
a failure. If the intention was "must remain empty or absent," move the matcher
to `expected_fields` or change the forbidden matcher to `not_empty: true`.

Use `forbidden_fields` for a state that must not occur, such as a populated
loan field in a cash transaction or a known stale value. Use
`expected_fields` for the desired final state. The current `empty` and `absent`
operators both accept a missing field; they do not prove that a key is
physically absent from the payload.

### Per-assertion pass rates

Use optional `min_pass_rate` when one assertion may tolerate occasional
variation across repeated runs. Configure the run count when launching the test
or adding it to a playlist. The threshold does not make the test repeat by
itself.

- The default is `1.0`: the assertion must pass every run.
- Use an unquoted number greater than `0` and at most `1`.
- Each assertion is evaluated independently. The test passes only when every
  assertion reaches its own threshold.
- Required passes are rounded up. With five runs, `0.8` requires four passes.
- Missing, failed, and `not_reached` results count as failed attempts.
- With one run, every valid threshold still requires one pass.

Place the key at the assertion entry for timeline assertions and bug
signatures:

```yaml
timeline_assertions:
  - id: review-follows-request
    min_pass_rate: 1.0
    after:
      event: user_said
      contains: send for review
    expect:
      event: agent_said
      contains: sent for review

bug_signature:
  - id: review-tool-used
    kind: tool_called
    name: send_for_review
    min_pass_rate: 0.8
```

For field assertions, place it inside the field expectation:

```yaml
expected_fields:
  buyer1_name:
    equals: Avery Morgan
    min_pass_rate: 1.0
```

The same shape applies to `forbidden_fields` and
`expected_prefilled_fields`. For an extraction turn, place it beside
`expected_newly_captured` and provide a stable `assertion_id`:

```yaml
extract_turns:
  - segments:
      - "user: The buyer is Avery Morgan."
    expected_newly_captured: [buyer1_name]
    assertion_id: buyer-name-captured
    min_pass_rate: 0.8
```

Give authored `bug_signature` entries an `id` when using thresholds. Field
assertion IDs are derived from their field names.

### Advisory assertions

Every assertion defaults to `blocking: true`. Set `blocking: false` when the
assertion should remain visible and measurable but must not determine the final
test or reliability-gate result:

```yaml
timeline_assertions:
  - id: summary-mentions-market-area
    blocking: false
    after:
      event: user_said
      contains: summary
    expect:
      event: agent_said
      contains: Maricopa County

expected_fields:
  optional_summary_label:
    equals: Market area
    blocking: false
```

The key must be an unquoted boolean. It is supported on `timeline_assertions`
and `bug_signature` entries; inside `expected_fields`, `forbidden_fields`, and
`expected_prefilled_fields` expectations; and on an `extract_turns` entry that
defines `expected_newly_captured`. A failed advisory is persisted as failed and
its repeated-run threshold is still calculated, but neither failure gates the
outcome. Keep at least one blocking deterministic oracle in reviewed and
promoted tests.

### Timeline assertion contract

Timeline assertions run during E2E and microtests. They observe the
conversation but never steer the voice agent or test user.

```yaml
timeline_assertions:
  - id: end-call-after-confirmation
    description: end_call follows the agent's hang-up prompt
    after:
      event: agent_said
      contains: hang up
    expect:
      event: tool_called
      name: end_call
    before:
      event: call_ended
```

- `after` is required and arms the assertion.
- Exactly one of `expect` or `forbid` is required.
- `before` is optional; call end is the default boundary.
- `trigger_required` defaults to `true`. If the trigger is never observed, the
  assertion becomes `not_reached` and the test fails. Set it to `false` only
  when absence of that entire branch is acceptable.
- Runtime states are `waiting`, `armed`, `passed`, `failed`, and `not_reached`.
- Supported events: `user_said`, `agent_said`, `tool_called`,
  `field_captured`, `trace_event`, `agent_handoff`, `checkpoint_restored`,
  `call_ended`.
- Matchers may use `contains`, `equals`, `name`, `field`, `turn`,
  `with_arguments`, and nested `details`.

#### Matching semantics

All populated matcher keys are AND conditions.

- `event` is an exact canonical event-type match.
- `contains` is a case-insensitive substring of the event label.
- `equals` is a case-insensitive complete-label match.
- `name` is a case-insensitive exact match against `details.name`, falling
  back to the label.
- `field` is an exact, case-sensitive match against `details.field` or a member
  of `details.fields`.
- `with_arguments` is a recursive subset of `details.arguments`.
- `details` is a recursive subset of the event details. Supplied scalar and
  list values compare exactly and case-sensitively.

There is no regex, implicit OR, fuzzy matching, or semantic paraphrase
matching. Use stable non-speech evidence when exact wording is not guaranteed.

#### Temporal semantics

The event matching `after` only arms the assertion; it cannot satisfy its own
`expect`, `forbid`, or `before`. Observation begins on the next emitted event.
An armed assertion does not reset when the trigger appears again.

On later events, evidence is evaluated before the boundary, so `expect` or
`forbid` wins when the same event also matches `before`. Passing and failing are
terminal, and assertions never stop or steer the conversation.

An armed expectation passes on evidence, fails when `before` arrives first, or
fails at call finalization if it is still armed. A missing required trigger is
`not_reached`; a missing optional trigger passes.

#### `forbid` lifecycle

Events before `after` are irrelevant to a prohibition. Once armed, matching
`forbid` fails immediately. Reaching `before` without that evidence passes.
Without `before`, it stays armed until finalization and then passes only if the
forbidden event never appeared.

A missing required trigger is `not_reached`, not a pass. Use
`trigger_required: false` only when absence of the entire branch is acceptable.

#### Turn matching

`turn` is an exact absolute integer filter. The initial greeting is turn `0`.
The first injected user message is turn `1`, and canonical events emitted while
processing that message—including agent speech, tools, extraction/trace
events, handoffs, and call end—share turn `1`. Multiple agent messages may
therefore share a turn.

`turn: 3` means “emitted during conversation turn 3,” not “the third matching
event” or “three turns after the trigger.” Prefer event-driven triggers unless
the test intentionally fixes the turn layout.

Use `before: {event: user_said}` when an expected response must occur before
the next caller turn. Omit `before` for a prohibition that should remain active
until the call ends.

The E2E executor will not inject another simulated caller turn when the
assistant has produced no correlated response. That condition fails the run as
a harness timing/error instead of manufacturing two consecutive caller turns.

For voice-focused E2E tests, prefer stable observable evidence: required tool
invocation, agent acknowledgement, phase transition, and terminal call
behavior. Do not assert external provider delivery unless delivery itself is
the behavior under test.

Do not weaken assertions to make a run pass. If product behavior is correct,
update the test with notes. If product behavior is wrong, keep the test strict.
