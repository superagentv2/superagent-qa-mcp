---
name: superagent-admin-db
description: "Use when Codex needs SuperAgent admin debug evidence: voice-call room links and traces, WhatsApp Text Sessions users, links and interaction traces, or schema-aware read-only database inspection."
---

# SuperAgent Admin DB

## Purpose

Use this skill to inspect SuperAgent runtime state when the active workspace is
not the SuperAgent monorepo. The hosted MCP supplies room and Text Sessions
evidence with server-side credentials. The bundled SQL and voice export scripts
use user-supplied local credentials in `~/.config/superagent/admin-db.env`.

Default to read-only evidence gathering. Do not mutate database rows, create
fixtures, delete debug records, or call mutating admin endpoints unless the user
explicitly asks for that exact write.

For an explicitly authorized template configuration migration, use the QA MCP
preview/apply tools described in
`../superagent-auto-qa/references/template-promotion.md`. Do not attempt a
promotion through the general read-only SQL helper. The NewVoice prompt library
is outside this promotion.

## First Moves

1. Identify a room id, voice debug URL, VAREA user id, WhatsApp sender/session id,
   Text Sessions interaction link, document id, or concrete question.
2. If QA MCP is available, call `qa_data_capabilities_get` and use its
   `qa_rooms_list`, `qa_room_get`, `qa_room_debug_get`, `qa_room_trace_get`,
   `qa_room_events_list`, `qa_room_logs_get`, `qa_room_fields_get`,
   `qa_templates_list`, and `qa_template_version_get` tools first. For WhatsApp
   evidence, use `qa_text_users_list`, `qa_text_user_links_list`,
   `qa_text_link_get`, `qa_text_interactions_list`, `qa_text_interaction_get`,
   or `qa_text_debug_link_get`. Read
   `../superagent-auto-qa/references/evidence-tools.md` for parameters,
   pagination, provenance, and prefill limits. Select `DEV` or `STAGING`
   explicitly; STAGING is production data.
3. If MCP evidence is unavailable or a question requires a narrow SQL join
   outside those tools, read `references/env-contract.md` and verify only
   that the required variables are present. Never print values.
4. For voice-call evidence outside MCP, read `references/admin-debug-api.md` and prefer
   `scripts/call_debug_export.py`.
   For WhatsApp evidence, read `references/text-debug-api.md`; its admin API
   requires an admin bearer token outside the hosted MCP.
5. For database evidence outside MCP, read `references/schema-map.md` and
   `references/query-recipes.md`, then use `scripts/db_query.py` for read-only
   SQL.
6. Report exact ids, counts, statuses, and JSON paths used. Redact passwords,
   tokens, signed URLs, private emails, and unnecessary transcript text.

## Evidence Strategy

- Start with admin debug APIs for a room/debug URL because they return the same
  voice-session and trace data used by the admin debug page.
- For a Text Sessions link, call `qa_text_debug_link_get` with the explicit
  environment. For a user, list their sender links, then page interaction
  summaries newest first and load only the specific trace needed. An unlinked
  sender remains in the archive; relinking the same user and sender continues
  the same cumulative session.
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
- `references/text-debug-api.md`: WhatsApp Text Sessions identities, links,
  pagination, interaction detail and copied-link access.
- `references/schema-map.md`: database table map for documents, templates,
  voice/debug, and QA state.
- `references/query-recipes.md`: safe read-only SQL probes.
