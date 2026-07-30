# Test Types And YAML

## Admin UI Test Types

The `/admin/qa` workbench centers on these normalized catalog test types:

- `replay`: voice-agent regression scenarios.
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
test_type: replay      # replay | extraction | microtest
```

The filesystem path is now an organization choice, not the source of truth. QA
users can create folders under `simulations/` and organize tests however they
prefer. The runner classifies definitions in this order:

1. Explicit YAML `test_type`.
2. Existing catalog/runner metadata for known rows.
3. YAML shape fallback: `snapshot`/`user_turns` implies `microtest`;
   `init_transcript`/`extract_turns` implies `extraction`.
4. Legacy path fallback only.

Do not rely on folder names to decide test behavior. Moving a micro-test into a
team folder must not turn it into a replay. If `test_type` contradicts the
editor or runner type, the admin API should reject the save or lifecycle change.

## Shared Metadata

Prefer these metadata fields on new or migrated definitions:

```yaml
test_type: replay      # replay | extraction | microtest
qa_status: draft        # draft | reviewed | promoted | archived
source_trace: manual-draft
jira: QA-SHORT-ID       # replay and microtest
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

## Replay Regression YAML

Schema source: `core/testing/regression_scenario.py::RegressionScenario`.

Important fields:

```yaml
test_type: replay
source_trace: evaluation-plan
qa_status: draft
jira: ACT-example
authored_by: qa-admin
notes: What this scenario protects.
contract_type: purchase
mode: New
mode_style: fast
ai_provider: codex
user_id: user_qa_draft
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

Use `user_mode: simulated` unless exact phrasing matters. Use `user_mode:
replay` only for literal transcript/utterance-sensitive paths.

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

In literal replay mode, the executor uses `matches_questions` to select an
intent and emits its `original_line` verbatim. Include matcher phrases only
when `user_mode: replay` needs them; omit them from simulated-mode definitions
unless the same fixture intentionally supports literal replay as well.

A replay starts a conversation and does not require a snapshot. Use a
micro-test instead when the test must resume from a known mid-call state.

Do not assume that adding `fake_backend` to replay YAML activates offline
execution. In the current hosted MCP/UI execution path, replays use the real
backend; fake-backend configuration is consumed only when the runner is
explicitly started in offline mode. Treat real backend writes and queued
external actions as intentional side effects when reviewing a replay.

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
user_id: user_qa_draft
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

## Micro-Test YAML

Schema source: `core/testing/regression_scenario.py::MicroTestFixture`.

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

Generated micro-tests must reference an approved existing snapshot. The browser
does not edit raw snapshot JSON.

## Assertions

Assertions are the oracle: the concrete checks that decide pass/fail.

Use:

- `expected_fields` / `forbidden_fields` for backend field-state gates.
- `bug_signature` for semantic behavior checks.
- `timeline_assertions` when ordering matters or the same evidence may appear
  elsewhere in the conversation.
- extraction `expected_fields` and `expected_newly_captured` for extraction.
- tool-call assertions when the behavior is observable as a tool call.

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

### Timeline assertion contract

Timeline assertions run during replay and microtests. They observe the
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
  `field_captured`, `trace_event`, `agent_handoff`, `call_ended`.
- Matchers may use `contains`, `equals`, `name`, `field`, `turn`,
  `with_arguments`, and nested `details`.

Use `before: {event: user_said}` when an expected response must occur before
the next caller turn. Omit `before` for a prohibition that should remain active
until the call ends.

The replay executor will not inject another simulated caller turn when the
assistant has produced no correlated response. That condition fails the run as
a harness timing/error instead of manufacturing two consecutive caller turns.

For voice-focused replays, prefer stable observable evidence: required tool
invocation, agent acknowledgement, phase transition, and terminal call
behavior. Do not assert external provider delivery unless delivery itself is
the behavior under test.

Do not weaken assertions to make a run pass. If product behavior is correct,
update the test with notes. If product behavior is wrong, keep the test strict.
