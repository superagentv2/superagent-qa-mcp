# Source Map

Use this as the first code-navigation map for SuperAgent QA automation.

## Canonical Docs

- Root planning notebook: `../QA_AUTOMATION_FEATURE_NOTEBOOK.md`
- Operational testing guide:
  `docs/evaluation/QA_AUTOMATION_TESTING_GUIDE.md`
- Onboarding and demo runbook:
  `docs/evaluation/QA_AUTOMATION_ONBOARDING.md`
- Regression/micro-test operator guide:
  `docs/REGRESSION_TESTS.md`
- Replay authoring guide:
  `docs/evaluation/HAPPY_PATH_REPLAY_GUIDE.md`
- Assertion catalog:
  `docs/evaluation/QA_ASSERTION_CATALOG.md`
- Eval tooling and profiles:
  `docs/evaluation/EVAL_METRICS_AND_TOOLS.md`
- Requirements and computed coverage:
  `docs/evaluation/REQUIREMENTS_AND_COVERAGE.md`
- Large E2E design/spec:
  `docs/E2E_TEST_INFRASTRUCTURE.md`
- Legacy/scenario test plan:
  `TEST_PLAN.md`, `TEST_SCENARIOS_E2E.md`

## Skill Helper Scripts

- Full composed manifest:
  `.agents/skills/superagent-auto-qa/scripts/qa_manifest.py`
- Current simulations catalog:
  `.agents/skills/superagent-auto-qa/scripts/qa_catalog.py`
- Documentation list/bundle:
  `.agents/skills/superagent-auto-qa/scripts/qa_docs.py`
- Compact inventory:
  `.agents/skills/superagent-auto-qa/scripts/qa_inventory.py`

## Agent Runner Code

- Runner API for admin UI: `runner_api.py`
- Main CLI: `evaluate.py`
- Replay and micro-test schema: `core/testing/regression_scenario.py`
- Extraction schema: `core/testing/extraction_scenario.py`
- Conversation runner: `core/testing/conversation_runner.py`
- Snapshot runtime model and capture/restore support:
  `core/testing/snapshot.py`
- Snapshot recipe bundles, capture gates, status, generation metadata, and
  candidate validation: `core/testing/snapshot_bundles.py`
- Assertion engine: `core/testing/assertions.py`
- Semantic bug signatures: `core/testing/bug_signature.py`
- Assertion catalog helpers:
  `core/testing/qa_assertion_catalog.py`,
  `core/testing/qa_assertion_catalog.yaml`
- Field assertions: `core/testing/field_assertions.py`
- Simulated caller: `core/testing/simulated_user.py`
- Literal replay user: `core/testing/intent_driven_user.py`
- Fake backend for offline micro-tests: `core/testing/fake_backend.py`
- Coverage/catalog scanner: `scripts/audit_eval_coverage.py`
- Requirements and coverage graph engine: `scripts/qa_coverage_system.py`

## Test Asset Roots

- YAML tests may live anywhere under `simulations/`; explicit YAML
  `test_type` is the semantic source of truth for new/edited files.
- Legacy replay/regression YAML: `simulations/regressions/**/*.yaml`
- Generated replay drafts: `simulations/regressions/generated/*.yaml`
- Candidate imported calls: `simulations/regressions/candidates/*.yaml`
- Known failing regressions: `simulations/regressions/known_failures/*.yaml`
- Extraction fixtures: `simulations/extraction/**/*.yaml`
- Generated extraction drafts: `simulations/extraction/generated/*.yaml`
- Micro-tests: `simulations/microtests/**/*.yaml`
- Generated micro-test drafts: `simulations/microtests/generated/*.yaml`
- Micro-test snapshots: `simulations/microtests/snapshots/**/*.json`
- Hidden managed snapshot recipes and generation metadata:
  `simulations/.snapshot-recipes/*.yaml`,
  `simulations/.snapshot-recipes/*.generation.json`
- Run artifacts: `artifacts/eval-runs/`
- Requirements source of truth: `docs/evaluation/requirements.yaml`
- Legacy coverage matrix, retained for history/migration: `docs/evaluation/COVERAGE_MATRIX.md`

## Frontend Admin UI

- QA entry route: `../superagentv2_frontend/app/admin/qa/page.tsx`
- Redirects from old routes:
  `../superagentv2_frontend/app/admin/evals/page.tsx`,
  `../superagentv2_frontend/app/qa-tests/page.tsx`
- QA workbench:
  `../superagentv2_frontend/components/superagent/qa/QAWorkbench.tsx`
- Snapshot recipe/JSON editor and generation monitor:
  `../superagentv2_frontend/components/superagent/qa/SnapshotBundleWorkbench.tsx`
- Runner client/types:
  `../superagentv2_frontend/lib/api/qa-runner.ts`
- Runner proxy:
  `../superagentv2_frontend/app/api/qa-runner/eval/[...path]/route.ts`
- Health proxy:
  `../superagentv2_frontend/app/api/qa-runner/health/route.ts`

## Backend Manifest Source

- Admin business manifest endpoint lives in `../superagentv_backend`.
- The runner calls:
  `/v1/admin/qa/manifest/business-schema`
- Use this for latest published pdfMe/schema-derived field names, contract
  types, addenda, and lifecycle/business values.
