---
name: superagent-admin-db
description: "Use when Codex needs to inspect SuperAgent database state or admin debug evidence outside the SuperAgent codebase: voice-call transcripts, room/debug links, LiveKit trace history/current state/metadata, contract document fields_json, template pdfme_layout, signature/provider fields, QA run records, or schema-aware read-only SQL probes using local credentials."
---

# SuperAgent Admin DB

## Purpose

Use this skill to inspect SuperAgent runtime state when the active workspace is
not the SuperAgent monorepo. The plugin supplies the operating knowledge and
scripts; the user supplies local credentials in `~/.config/superagent/admin-db.env`.

Default to read-only evidence gathering. Do not mutate database rows, create
fixtures, delete debug records, or call mutating admin endpoints unless the user
explicitly asks for that exact write.

## First Moves

1. Confirm the user provided a room id, debug URL, document id, template slug,
   contract instance id, or a concrete question.
2. If credentials are needed, read `references/env-contract.md` and verify only
   that the required variables are present. Never print values.
3. For voice-call evidence, read `references/admin-debug-api.md` and prefer
   `scripts/call_debug_export.py`.
4. For database evidence, read `references/schema-map.md` and
   `references/query-recipes.md`, then use `scripts/db_query.py` for read-only
   SQL.
5. Report exact ids, counts, statuses, and JSON paths used. Redact passwords,
   tokens, signed URLs, private emails, and unnecessary transcript text.

## Evidence Strategy

- Start with admin debug APIs for a room/debug URL because they return the same
  voice-session and trace data used by the admin debug page.
- Use database probes when the question depends on persisted state, template
  layout, generated document metadata, provider ids, or joins across runtime
  tables.
- Compare layers when relevant: transcript/trace turn -> persisted document
  state -> template/layout -> provider/status field.
- Keep outputs narrow. Select only the columns and JSON paths needed for the
  question and use `limit` clauses for exploratory queries.

## Hard Rules

- Never include credentials in the skill, README examples, chat output, commit
  messages, or artifacts.
- Never `source` the env file. Parse it as inert `KEY=VALUE` text or let the
  bundled scripts parse it.
- Do not run `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `TRUNCATE`,
  migrations, grants, or repair SQL through this skill.
- Treat production as read-only. If the user asks for production, state the
  selected environment before running anything.
- Do not paste full private transcripts into chat unless the user explicitly
  asks. Prefer concise excerpts, counts, and local artifact paths.

## References

Load only what the task needs:

- `references/env-contract.md`: local env file path and variable names.
- `references/admin-debug-api.md`: voice-session, transcript, debug, trace, and
  metadata endpoint access.
- `references/schema-map.md`: database table map for documents, templates,
  voice/debug, and QA state.
- `references/query-recipes.md`: safe read-only SQL probes.
