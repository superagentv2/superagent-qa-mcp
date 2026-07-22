# Query Recipes

Run with:

```bash
python3 skills/superagent-admin-db/scripts/db_query.py --env dev --sql '<SQL>'
```

The script rejects mutating SQL and runs transactions as read-only. Still use
focused `select` lists and `limit` clauses; the database is not a piñata.

## Locate A Voice Session

```sql
select
  id,
  livekit_room_id,
  created_by_user_id,
  contract_instance_id,
  template_version_id,
  call_status,
  call_type,
  duration_ms,
  disconnection_reason,
  test_type,
  created_at
from voice_session
where livekit_room_id = 'room-...'
limit 1;
```

## Transcript Summary Without Dumping Full Text

```sql
select
  livekit_room_id,
  call_status,
  length(coalesce(transcript, '')) as transcript_chars,
  left(coalesce(transcript, ''), 500) as transcript_excerpt
from voice_session
where livekit_room_id = 'room-...'
limit 1;
```

Use excerpts in chat. Avoid pasting full transcripts unless explicitly asked.

## Interleaved Debug Timeline Sources

```sql
select 'trace' as source, id::text, event_type, created_at, header as text
from voice_trace_event
where room_id = 'room-...'
union all
select 'user', id::text, 'USER_TURN', created_at, left(transcript, 300)
from voice_user_turn
where room_id = 'room-...'
union all
select 'agent', id::text, 'AGENT_TURN:' || source, created_at, left(transcript, 300)
from voice_agent_turn
where room_id = 'room-...'
order by created_at, id
limit 200;
```

## Trace Event Counts

```sql
select event_type, count(*) as count
from voice_trace_event
where room_id = 'room-...'
group by event_type
order by count desc, event_type;
```

## Linked Document For A Room

```sql
select
  cd.id,
  cd.document_type,
  cd.status,
  cd.doc_variant,
  cd.counter_number,
  cd.template_version_id,
  cd.provider_name,
  cd.provider_envelope_id,
  cd.envelope_status,
  cd.sent_for_signature_at,
  cd.response_signed_pdf_url is not null as has_response_signed_pdf,
  cd.storage_url is not null as has_storage_url
from contract_document cd
join voice_session vs on vs.id = cd.voice_session_id
where vs.livekit_room_id = 'room-...'
order by cd.created_at desc
limit 10;
```

## Selected Field Values

```sql
select
  cd.id,
  cd.status,
  cd.fields_json::jsonb ->> 'seller' as seller,
  cd.fields_json::jsonb ->> 'buyer' as buyer,
  cd.fields_json::jsonb ->> 'offer' as offer,
  cd.fields_json::jsonb ->> 'counter_offer' as counter_offer
from contract_document cd
where cd.id = '00000000-0000-0000-0000-000000000000'
limit 1;
```

Change the JSON paths to the fields named by the ticket. Do not dump
`fields_json` raw unless the user asks for a local artifact.

## Template Field Coordinates

```sql
select
  t.jurisdiction_code,
  t.slug,
  t.template_type,
  v.id as template_version_id,
  v.version_number,
  v.status,
  page_ord - 1 as page_index,
  field ->> 'name' as field_name,
  field ->> 'type' as field_type,
  field -> 'position' as position,
  field ->> 'width' as width,
  field ->> 'height' as height
from contract_template_version v
join contract_template t on t.id = v.template_id
cross join lateral jsonb_array_elements(v.pdfme_layout -> 'schemas') with ordinality as page(schema, page_ord)
cross join lateral jsonb_array_elements(page.schema) as field
where t.slug = 'template-slug'
  and field ->> 'name' in ('field_one', 'field_two')
order by page_index, field_name
limit 100;
```

## Required Fields Metadata

```sql
select
  id,
  required_fields_total,
  required_fields_missing_count,
  required_fields_missing_keys,
  required_fields_last_checked_at
from contract_document
where id = '00000000-0000-0000-0000-000000000000'
limit 1;
```

## Call Events Around A Room

```sql
select
  created_at,
  category,
  event_type,
  duration_ms,
  source,
  data
from call_event
where room_id = 'room-...'
order by created_at
limit 200;
```
