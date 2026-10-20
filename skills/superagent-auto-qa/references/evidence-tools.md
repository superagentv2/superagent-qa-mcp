# Room and Template Evidence Tools

Use `qa_data_capabilities_get` first. Every data tool requires `environment`:
`DEV` or `STAGING`. STAGING is production data. The existing MCP token covers
both environments. These tools only read; other QA MCP tools may still mutate
QA assets or run tests.

## Room investigation

1. Discover active or completed calls with `qa_rooms_list`. Filter by
   `created_from`, `created_to`, or `status`; follow `next_cursor` to page.
2. Read `qa_room_get` for the persisted session and transcript, then
   `qa_room_debug_get` for the backend-computed trace current state and
   metadata. A missing backend source appears as `unavailable` in the debug
   view; it does not invalidate the database session.
3. Use `qa_room_trace_get` for bounded legacy trace events and user/agent
   turns. Follow each `next_id` independently. AgentV2 `newvoice` trace lives
   in `call_event`; use `qa_room_events_list` and its cursor for that evidence.
4. Use `qa_room_logs_get` separately for `backend`, `frontend`, or `agent`.
   Follow `next_offset` while `has_more` is true. A 4 MiB prefix limit is
   reported as `byte_truncated`; log absence or backend failure returns a tool
   error. These logs are stored in the backend's live buffer or object storage.
5. Use `qa_room_fields_get` for room-linked document `fields_json`,
   `fields_meta_json`, document version IDs, recorded dynamic variables,
   recorded `PREFILL` events, the linked user's *current* profile, and versioned prefill mappings.
   `link=voice_session` is a direct room link; `link=contract_instance` is a
   wider deal link. Follow `next_cursor` for more documents. The current
   profile is not proof of its historical value.

`PREFILL` event fields are source values; merge precedence can change the
effective document values. If `prefill_events_more` is true, page through
`qa_room_events_list` with `category=PREFILL`. No immutable final call-time effective-prefill snapshot is available. The tool
returns `effective_user_prefills_at_call_time: null` and states this limit.
Do not infer that a final field value was originally prefilled.

## Template investigation

Use `qa_templates_list` to find current draft/published versions. Read an exact
version with `qa_template_version_get`; pass the session or document's
`template_version_id` to inspect a historical room-linked version. The default
response includes flattened PDFMe fields and prefill mappings. Set
`full_config=true` only when the full versioned PDFMe layout and prompt texts
are needed. Historical rows can be inactive or deprecated and remain readable.

All tools return full relevant evidence within bounded pages. They never
return reusable signed download URLs or backend/database credentials. Cite
the environment, room/version ID, source tool, cursor/page, and any
`unavailable` or `truncated` flag when reporting conclusions.
