# WhatsApp Text Sessions Debug Evidence

The hosted QA MCP calls the admin Text Sessions backend API with its existing
QA evidence token. Use the MCP tools first; they require `environment=DEV` or
`STAGING` and expose the same read contract as the admin UI. STAGING is
production data. Do not put tokens or full private conversations in chat.

## Identity and links

One durable text session belongs to a `(VAREA user clerk id, WhatsApp sender id)`
pair. The numeric `session_id` identifies that pair across unlink and relink.
`connectionId` identifies one link episode. The numeric `message_id` identifies
one incoming message or command together with its response and debug evidence.

A copied interaction link has this form:

```text
https://<admin-host>/admin/text-sessions/<userClerkId>/<sessionId>?message=<messageId>
```

Use `qa_text_debug_link_get` for a full link. The explicit MCP environment is
authoritative; the link's host is never fetched. The tool validates the URL
shape and verifies that `userClerkId` matches the returned sender session.

## Read sequence

| Question | MCP tool | Backend GET path |
| --- | --- | --- |
| Which users have a WhatsApp link? | `qa_text_users_list` | `/v1/admin/text-sessions/users?page=&size=` |
| Which senders belong to a user? | `qa_text_user_links_list` | `/v1/admin/text-sessions/users/{userClerkId}/sessions?page=&size=` |
| What is this sender's link history? | `qa_text_link_get` | `/v1/admin/text-sessions/{sessionId}` and `/{sessionId}/episodes` |
| What interactions occurred? | `qa_text_interactions_list` | `/v1/admin/text-sessions/{sessionId}/messages?page=&size=&anchorId=` |
| What happened in one interaction? | `qa_text_interaction_get` | `/v1/admin/text-sessions/{sessionId}/messages/{messageId}` |

List responses are bounded to 100 rows per request. Interaction summaries
contain at most 500 characters of inbound and response text. Keep the first
message page's `anchorId` for subsequent pages. The detail endpoint alone
returns full text, lifecycle `events`, `provenance`, and the AI `trace` at
`provenance.trace`; the recorder caps the trace at 200 events and reports
`omitted_events` when it reaches that cap.

The user list reads archived WhatsApp sessions, not every VAREA account. A
link with no messages is listed. Unlink does not remove its archive. Current
links are registered when the archive migration runs, but older conversations
and audio files are not reconstructed or retained.

The QA evidence token is accepted only on these six GET routes. Outside the
hosted MCP, admin endpoints require normal admin authentication; the bundled
voice-call exporter is not a Text Sessions exporter.
