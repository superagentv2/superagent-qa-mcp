import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { databasePoolConfig } from "./database-connection.js";

type Environment = "DEV" | "STAGING";
const environment = z.enum(["DEV", "STAGING"]);
const roomId = z.string().min(1).max(255).regex(/^[a-zA-Z0-9_-]+$/);
const uuid = z.string().uuid();
const pageSize = z.number().int().min(1).max(100).default(25);
const schemas: Record<Environment, string> = {
  DEV: "superagent_dev_schema",
  STAGING: "superagent_staging_schema",
};
const pools = new Map<Environment, Pool>();

function settings(env: Environment) {
  const suffix = env === "DEV" ? "DEV" : "STAGING";
  return {
    databaseUrl: process.env[`EVIDENCE_${suffix}_DATABASE_URL`]?.trim(),
    backendUrl: process.env[`EVIDENCE_${suffix}_BACKEND_URL`]?.trim(),
    backendToken: process.env[`EVIDENCE_${suffix}_BACKEND_TOKEN`]?.trim(),
  };
}

function pool(env: Environment): Pool {
  const url = settings(env).databaseUrl;
  if (!url) throw new Error(`${env} evidence database is not configured`);
  let value = pools.get(env);
  if (!value) {
    value = new Pool(databasePoolConfig(url, { max: 1, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000, application_name: `superagent_qa_mcp_${env.toLowerCase()}` }));
    pools.set(env, value);
  }
  return value;
}

async function read<T>(env: Environment, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool(env).connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8s'");
    await client.query(`SET LOCAL search_path TO ${schemas[env]}`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function cursorEncode(value: unknown): string { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function cursorDecode(value: string | undefined, shape: z.ZodTypeAny): any {
  if (!value) return undefined;
  try { return shape.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))); }
  catch { throw new Error("Invalid cursor"); }
}
const roomCursor = z.object({ created_at: z.string().min(1).max(64), id: uuid });
const eventCursor = z.object({ created_at: z.string().min(1).max(64), id: uuid });
const idCursor = z.object({ id: uuid });
function page<T extends Record<string, any>>(rows: T[], limit: number, next: (row: T) => unknown) {
  const items = rows.slice(0, limit);
  return { items, next_cursor: rows.length > limit ? cursorEncode(next(items[items.length - 1])) : null };
}
export function result(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, (key, value) => {
    if (/^(?:authorization|api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|recording_url|signed_url)$/i.test(key)) {
      return value == null ? value : "[redacted]";
    }
    if (typeof value === "string") {
      return value
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
        .replace(/(X-Amz-(?:Signature|Credential|Security-Token)=)[^&\s]+/gi, "$1[redacted]")
        .replace(/((?:token|api_key|password|secret)=)[^&\s]+/gi, "$1[redacted]");
    }
    return value;
  }) }] };
}
function failure(error: unknown) {
  // Driver and upstream errors can contain connection strings, SQL, or response bodies.
  const message = error instanceof Error && /not configured|Invalid cursor/.test(error.message)
    ? error.message : "Evidence request failed; check server configuration and logs";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
export async function safe(fn: () => Promise<unknown>) {
  try { return result(await fn()); } catch (error) { return failure(error); }
}
async function backend(env: Environment, path: string): Promise<unknown> {
  const { backendUrl, backendToken } = settings(env);
  if (!backendUrl || !backendToken) throw new Error(`${env} evidence backend is not configured`);
  const base = new URL(backendUrl);
  if (!/^https?:$/.test(base.protocol)) throw new Error("Invalid backend URL");
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  const target = new URL(path.replace(/^\//, ""), new URL(basePath, base));
  const response = await fetch(target, {
    headers: { "X-QA-Evidence-Token": backendToken },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Evidence backend request failed");
  return response.json();
}
function fields(layout: any) {
  const schemas = Array.isArray(layout?.schemas) ? layout.schemas : [];
  return schemas.flatMap((items: any, page: number) => Array.isArray(items)
    ? items.map((item: any) => ({ page: page + 1, name: item.name, type: item.type,
      required: item.required, readOnly: item.readOnly, content: item.content,
      options: item.options, mapping: item.counter_context_mapping })) : []);
}

export function registerEvidenceTools(server: McpServer) {
  server.tool("qa_data_capabilities_get", "Show configured DEV/STAGING evidence sources and read-only tool scope", {},
    async () => result({ environments: (["DEV", "STAGING"] as const).map((env) => ({
      environment: env, production_data: env === "STAGING", database: Boolean(settings(env).databaseUrl),
      backend: Boolean(settings(env).backendUrl && settings(env).backendToken),
    })), access: "read-only", shared_mcp_token: true }));

  server.tool("qa_rooms_list", "List active and historical call rooms with date/status filters", {
    environment, limit: pageSize, cursor: z.string().optional(), status: z.string().max(50).optional(),
    created_from: z.string().datetime().optional(), created_to: z.string().datetime().optional(),
  }, async (a) => safe(async () => read(a.environment, async (db) => {
    const after = cursorDecode(a.cursor, roomCursor);
    const rows = await db.query(`SELECT id, livekit_room_id, call_status, call_type, created_at,
      created_at::text AS cursor_created_at, updated_at,
      start_timestamp, end_timestamp, duration_ms, template_version_id, contract_instance_id
      FROM voice_session WHERE livekit_room_id IS NOT NULL AND is_active = true
      AND ($1::text IS NULL OR call_status = $1)
      AND ($2::timestamptz IS NULL OR created_at >= $2)
      AND ($3::timestamptz IS NULL OR created_at < $3)
      AND ($4::timestamptz IS NULL OR (created_at, id) < ($4, $5::uuid))
      ORDER BY created_at DESC, id DESC LIMIT $6`,
      [a.status ?? null, a.created_from ?? null, a.created_to ?? null,
        after?.created_at ?? null, after?.id ?? null, a.limit + 1]);
    return { environment: a.environment, ...page(rows.rows, a.limit,
      (row) => ({ created_at: row.cursor_created_at, id: row.id })) };
  })));

  server.tool("qa_room_get", "Read a call room's persisted session evidence without signed URLs", {
    environment, room_id: roomId,
  }, async (a) => safe(async () => read(a.environment, async (db) => {
    const rows = await db.query(`SELECT id, livekit_room_id, call_status, call_type, created_at,
      updated_at, start_timestamp, end_timestamp, duration_ms, disconnection_reason,
      created_by_user_id, contract_instance_id, template_version_id, transcript,
      call_metadata, collected_dynamic_variables, call_analysis, llm_context
      FROM voice_session WHERE livekit_room_id = $1 AND is_active = true
      ORDER BY created_at DESC LIMIT 1`, [a.room_id]);
    return { environment: a.environment, source: "voice_session", room: rows.rows[0] ?? null };
  })));

  server.tool("qa_room_fields_get", "Read documents linked to a room, persisted values and recorded dynamic variables", {
    environment, room_id: roomId, limit: pageSize, cursor: z.string().optional(),
  }, async (a) => safe(async () => read(a.environment, async (db) => {
    const after = cursorDecode(a.cursor, roomCursor);
    const session = await db.query(`SELECT id, contract_instance_id, template_version_id,
      created_by_user_id, collected_dynamic_variables FROM voice_session
      WHERE livekit_room_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`, [a.room_id]);
    if (!session.rows[0]) return { environment: a.environment, room_id: a.room_id, session: null, documents: [] };
    const s = session.rows[0];
    const docs = await db.query(`SELECT id, voice_session_id, contract_instance_id, template_version_id,
      document_type, status, fields_json, fields_meta_json, created_at,
      created_at::text AS cursor_created_at, updated_at
      FROM contract_document WHERE is_active = true
      AND (voice_session_id = $1::uuid OR ($2::uuid IS NOT NULL AND contract_instance_id = $2::uuid))
      AND ($3::timestamp IS NULL OR (created_at, id) < ($3::timestamp, $4::uuid))
      ORDER BY created_at DESC, id DESC LIMIT $5`,
      [s.id, s.contract_instance_id, after?.created_at ?? null, after?.id ?? null, a.limit + 1]);
    const profile = s.created_by_user_id ? await db.query(`SELECT to_jsonb(p) - 'clerk_user_id' AS data
      FROM agent_profile p WHERE p.clerk_user_id = $1 AND p.is_active = true`, [s.created_by_user_id]) : null;
    const mappings = s.template_version_id ? await db.query(`SELECT document_field_id, source_type,
      source_field_key, document_type FROM document_field_prefill_mapping
      WHERE template_version_id = $1 AND is_active = true ORDER BY document_field_id, source_type`,
      [s.template_version_id]) : null;
    const prefillEvents = await db.query(`SELECT id, event_type, data, created_at FROM call_event
      WHERE room_id = $1 AND category = 'PREFILL' ORDER BY created_at ASC, id ASC LIMIT 101`,
      [a.room_id]);
    return { environment: a.environment, room_id: a.room_id, session_template_version_id: s.template_version_id,
      user_id: s.created_by_user_id, recorded_dynamic_variables: s.collected_dynamic_variables,
      current_user_profile: profile?.rows[0]?.data ?? null,
      versioned_prefill_mappings: mappings?.rows ?? [],
      recorded_prefill_events: prefillEvents.rows.slice(0, 100),
      prefill_events_more: prefillEvents.rows.length > 100,
      effective_user_prefills_at_call_time: null,
      prefill_note: "PREFILL events record source values when emitted; their raw fields may be overridden by higher-precedence sources. Current profile and versioned mappings are current/configured evidence. No immutable final call-time effective-prefill snapshot is persisted.",
      documents: docs.rows.slice(0, a.limit).map((d) => ({ ...d,
        link: d.voice_session_id === s.id ? "voice_session" : "contract_instance" })),
      next_cursor: docs.rows.length > a.limit ? cursorEncode({
        created_at: docs.rows[a.limit - 1].cursor_created_at,
        id: docs.rows[a.limit - 1].id }) : null };
  })));

  server.tool("qa_room_events_list", "Page through persisted call events, including AgentV2 events", {
    environment, room_id: roomId, limit: pageSize, cursor: z.string().optional(),
    category: z.string().max(32).optional(),
  }, async (a) => safe(async () => read(a.environment, async (db) => {
    const after = cursorDecode(a.cursor, eventCursor);
    const rows = await db.query(`SELECT id, room_id, user_id, category, event_type, data,
      duration_ms, source, created_at, created_at::text AS cursor_created_at
      FROM call_event WHERE room_id = $1
      AND ($2::text IS NULL OR category = $2)
      AND ($3::timestamptz IS NULL OR (created_at, id) > ($3, $4::uuid))
      ORDER BY created_at ASC, id ASC LIMIT $5`,
      [a.room_id, a.category ?? null, after?.created_at ?? null, after?.id ?? null, a.limit + 1]);
    return { environment: a.environment, ...page(rows.rows, a.limit,
      (row) => ({ created_at: row.cursor_created_at, id: row.id })) };
  })));

  server.tool("qa_room_trace_get", "Read bounded legacy trace and turn pages plus backend-computed current state", {
    environment, room_id: roomId, limit: pageSize,
    since_event_id: z.number().int().min(0).default(0), since_user_turn_id: z.number().int().min(0).default(0),
    since_agent_turn_id: z.number().int().min(0).default(0),
  }, async (a) => safe(async () => {
    const history = await read(a.environment, async (db) => {
      const specs = [
        ["voice_trace_event", a.since_event_id, "id, room_id, event_type, header, body, created_at"],
        ["voice_user_turn", a.since_user_turn_id, "id, room_id, transcript, created_at"],
        ["voice_agent_turn", a.since_agent_turn_id, "id, room_id, transcript, source, created_at"],
      ] as const;
      const parts = await Promise.all(specs.map(async ([table, since, columns]) => {
        const data = await db.query(`SELECT ${columns} FROM ${table} WHERE room_id = $1 AND id > $2
          ORDER BY id ASC LIMIT $3`, [a.room_id, since, a.limit + 1]);
        return { items: data.rows.slice(0, a.limit), next_id: data.rows.length > a.limit
          ? Number(data.rows[a.limit - 1].id) : null };
      }));
      return { events: parts[0], user_turns: parts[1], agent_turns: parts[2] };
    });
    const url = `/v1/livekit/trace/current-state?roomId=${encodeURIComponent(a.room_id)}`;
    const metadataUrl = `/v1/livekit/trace/metadata?roomId=${encodeURIComponent(a.room_id)}`;
    const [current, metadata] = await Promise.allSettled([backend(a.environment, url), backend(a.environment, metadataUrl)]);
    return { environment: a.environment, room_id: a.room_id, history,
      current_state: current.status === "fulfilled" ? current.value : { unavailable: true },
      metadata: metadata.status === "fulfilled" ? metadata.value : { unavailable: true },
      newvoice_history: "Use qa_room_events_list; AgentV2 trace is projected from call_event by the backend." };
  }));

  server.tool("qa_room_logs_get", "Read bounded backend/frontend/agent log excerpts for one room", {
    environment, room_id: roomId, source: z.enum(["backend", "frontend", "agent"]),
    offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(100),
  }, async (a) => safe(async () => ({ environment: a.environment, room_id: a.room_id,
    ...await backend(a.environment, `/v1/call-logs/${encodeURIComponent(a.room_id)}/${a.source}/excerpt?offset=${a.offset}&limit=${a.limit}`) as object })));

  server.tool("qa_templates_list", "Page through contract templates and current draft/published versions", {
    environment, limit: pageSize, cursor: z.string().optional(),
    template_type: z.string().max(32).optional(), product_family: z.enum(["PURCHASE", "LEASE", "LISTING"]).optional(),
    search: z.string().max(128).optional(),
  }, async (a) => safe(async () => read(a.environment, async (db) => {
    const after = cursorDecode(a.cursor, idCursor);
    const rows = await db.query(`SELECT t.id, t.slug, t.title, t.template_type,
      t.product_family, t.jurisdiction_code,
      t.is_active, t.created_at,
      (SELECT json_agg(json_build_object('id', v.id, 'version_number', v.version_number,
        'status', v.status) ORDER BY v.version_number DESC)
       FROM contract_template_version v WHERE v.template_id = t.id AND v.is_active = true
       AND v.status IN ('DRAFT', 'PUBLISHED')) AS current_versions
      FROM contract_template t WHERE t.is_active = true
      AND ($1::text IS NULL OR t.template_type = $1)
      AND ($2::text IS NULL OR t.product_family = $2)
      AND ($3::text IS NULL OR t.slug ILIKE '%' || $3 || '%' OR t.title ILIKE '%' || $3 || '%')
      AND ($4::uuid IS NULL OR t.id > $4::uuid) ORDER BY t.id ASC LIMIT $5`,
      [a.template_type ?? null, a.product_family ?? null, a.search ?? null,
        after?.id ?? null, a.limit + 1]);
    return { environment: a.environment, ...page(rows.rows, a.limit, (row) => ({ id: row.id })) };
  })));

  server.tool("qa_template_version_get", "Read an exact historical/current version, optionally full layout and prompts", {
    environment, version_id: uuid, full_config: z.boolean().default(false),
  }, async (a) => safe(async () => read(a.environment, async (db) => {
    const rows = await db.query(`SELECT v.id, v.template_id, v.version_number, v.status,
      v.is_active, v.created_at, v.updated_at, v.pdfme_layout, v.template_prompt,
      v.extraction_prompt, v.voice_agent_prompt, t.slug, t.title, t.template_type,
      t.product_family,
      t.jurisdiction_code FROM contract_template_version v
      JOIN contract_template t ON t.id = v.template_id WHERE v.id = $1`, [a.version_id]);
    const v = rows.rows[0];
    if (!v) return { environment: a.environment, version: null };
    const mappings = await db.query(`SELECT document_field_id, source_type, source_field_key,
      document_type, is_active FROM document_field_prefill_mapping
      WHERE template_version_id = $1 ORDER BY document_field_id, source_type`, [a.version_id]);
    const { pdfme_layout, template_prompt, extraction_prompt, voice_agent_prompt, ...summary } = v;
    return { environment: a.environment, version: summary, fields: fields(pdfme_layout),
      prefill_mappings: mappings.rows,
      ...(a.full_config ? { pdfme_layout, template_prompt, extraction_prompt, voice_agent_prompt } : {}) };
  })));

  server.tool("qa_room_debug_get", "Read room session, trace current state and metadata in one bounded view", {
    environment, room_id: roomId,
  }, async (a) => safe(async () => {
    const session = await read(a.environment, async (db) => {
      const rows = await db.query(`SELECT id, livekit_room_id, call_status, call_type,
        created_at, updated_at, template_version_id, contract_instance_id, transcript,
        call_metadata, collected_dynamic_variables, call_analysis FROM voice_session
        WHERE livekit_room_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`, [a.room_id]);
      return rows.rows[0] ?? null;
    });
    const [state, metadata] = await Promise.allSettled([
      backend(a.environment, `/v1/livekit/trace/current-state?roomId=${encodeURIComponent(a.room_id)}`),
      backend(a.environment, `/v1/livekit/trace/metadata?roomId=${encodeURIComponent(a.room_id)}`),
    ]);
    return { environment: a.environment, room_id: a.room_id, session,
      current_state: state.status === "fulfilled" ? state.value : { unavailable: true },
      metadata: metadata.status === "fulfilled" ? metadata.value : { unavailable: true },
      next: ["qa_room_trace_get", "qa_room_events_list", "qa_room_logs_get", "qa_room_fields_get"] };
  }));
}
