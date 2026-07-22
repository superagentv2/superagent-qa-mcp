# Admin Debug API

Use these endpoints for room/debug-link investigations before reaching for raw
SQL. They mirror the admin debug page surfaces and are usually the fastest path
to transcript and trace evidence.

Base URL examples:

- DEV: `https://back-dev.superagent.estate/api`
- Local backend: `http://localhost:8080/api`

Headers:

```text
X-API-KEY: <SUPERAGENT_BACKEND_API_KEY_ENV>
Authorization: Bearer <SUPERAGENT_ADMIN_BEARER_TOKEN_ENV>   # when available/required
Content-Type: application/json
```

Never print header values.

## Room Id Extraction

Debug URLs and tickets usually contain a LiveKit room id shaped like:

```text
room-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Use that id for both admin voice-session and trace endpoints.

## Endpoints

### Voice Session By Room

```http
GET /v1/admin/voice-sessions/by-room/{roomId}
```

Purpose:

- full voice-session detail;
- transcript;
- recording URL;
- linked document status/type;
- linked `fieldsJson` when resolvable.

If this endpoint returns 401/403, classify it as auth/setup blocked and check
whether `SUPERAGENT_ADMIN_BEARER_TOKEN_<ENV>` is missing or stale.

### Trace Current State

```http
GET /v1/livekit/trace/current-state?roomId={roomId}
```

Purpose:

- latest state-bearing `MUTATION` or `SECTION_LOAD`;
- latest `TOOL_CALL`;
- latest `AGENT_INSTRUCTIONS`;
- max trace event id.

Use this for "what did the debug page show most recently?" questions.

### Trace History

```http
GET /v1/livekit/trace/history?roomId={roomId}&sinceEventId=0&sinceUserTurnId=0&sinceAgentTurnId=0
```

Purpose:

- section trace events;
- final user transcript turns;
- assistant/agent speech turns;
- paging watermarks.

Use this for timeline reconstruction and first-wrong-decision analysis.

### Trace Metadata

```http
GET /v1/livekit/trace/metadata?roomId={roomId}
```

Purpose:

- event counts by type;
- mutation/source counters;
- transition/anomaly metadata for debug headers.

## Script

Prefer:

```bash
python3 skills/superagent-admin-db/scripts/call_debug_export.py \
  --env dev \
  --room-id room-... \
  --out /tmp/superagent-room-debug.json
```

Or pass a debug URL:

```bash
python3 skills/superagent-admin-db/scripts/call_debug_export.py \
  --debug-url 'https://...room-...' \
  --env dev
```

The script writes a redacted local JSON artifact and prints only source
presence, counts, hostnames, and the artifact path.
