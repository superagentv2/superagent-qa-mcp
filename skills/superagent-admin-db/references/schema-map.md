# Schema Map

Confirm live columns with `information_schema` when exact schema drift matters.
This map names the SuperAgent tables that most often explain bug reports.

## Documents And Templates

`contract_document`

- Core runtime document row.
- Important columns: `id`, `contract_instance_id`, `listing_id`,
  `template_version_id`, `voice_session_id`, `document_type`, `status`,
  `doc_variant`, `counter_number`, `fields_json`, `fields_meta_json`,
  `creation_method`, `provider_envelope_id`, `provider_name`,
  `envelope_status`, `sent_for_signature_at`, `storage_url`,
  `response_signed_pdf_url`, `required_fields_*`, `agent_approved_*`,
  `responding_agent_*`, `version_number`, `superseded_by`,
  `supersession_reason`, `is_immutable`, `offering_party`, `upload_pending`,
  `upload_pending_label`, `ai_summary`, `ai_summary_generated_at`.
- Use it for generated field state, counter-offer state, signing/package
  metadata, addenda flags, summary state, and linked voice-session bugs.

`contract_template`

- Template identity.
- Important columns: `id`, `jurisdiction_code`, `slug`, `title`,
  `template_type`.

`contract_template_version`

- Versioned template layout and prompts.
- Important columns: `id`, `template_id`, `version_number`, `status`,
  `pdfme_layout`, `template_prompt`, `extraction_prompt`,
  `voice_agent_prompt`.
- Use `pdfme_layout->'schemas'` to inspect field coordinates, addendum
  metadata, signing triggers, conditional rules, and voice/extraction mappings.

## Voice And Debug

`voice_session`

- Call/session owner.
- Important columns: `id`, `retell_call_id`, `livekit_room_id`,
  `created_by_user_id`, `contract_instance_id`, `template_version_id`,
  `llm_context`, `call_status`, `call_type`, `agent_id`, `agent_name`,
  `start_timestamp`, `end_timestamp`, `duration_ms`,
  `disconnection_reason`, `call_metadata`, `collected_dynamic_variables`,
  `call_analysis`, `transcript`, `recording_url`, `last_webhook_payload`,
  `test_type`.

`voice_trace_event`

- Append-only section trace event stream for admin debug.
- Columns: `id`, `room_id`, `event_type`, `header`, `body`, `created_at`.

`voice_user_turn`

- Final user transcript turns mirrored from the voice agent.
- Columns: `id`, `room_id`, `transcript`, `created_at`.

`voice_agent_turn`

- Assistant speech turns mirrored from the voice agent.
- Columns: `id`, `room_id`, `transcript`, `source`, `created_at`.
- `source` is usually `llm` or `say`.

`call_event`

- Append-only observability events.
- Columns: `id`, `room_id`, `user_id`, `category`, `event_type`, `data`,
  `duration_ms`, `source`, `created_at`.

## QA

`qa_simulation`

- QA simulation definition metadata.

`qa_simulation_run`

- QA run record. Useful columns include `voice_session_id` and `transcript`.

Quality check/evaluation tables connect voice-session transcripts to
LLM-judged quality results. Confirm names live before querying because this area
can evolve with QA tooling.

## Query Rules

- Prefer joining by `voice_session.livekit_room_id` for room/debug-link work.
- Prefer joining `contract_document.voice_session_id = voice_session.id` when
  looking for the document created by a call.
- Prefer joining `contract_document.template_version_id =
  contract_template_version.id` and then `contract_template_version.template_id =
  contract_template.id` for layout/template bugs.
- Use JSONB operators to select exact paths instead of dumping full JSON blobs.
