import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { result } from "./evidence.js";

type Environment = "DEV" | "STAGING";
type TemplateKey = {
  jurisdiction_code: string;
  product_family: "PURCHASE" | "LEASE" | "LISTING";
  template_type: string;
  slug: string | null;
};
type Mapping = { document_type: string; document_field_id: string; source_type: string; source_field_key: string };
type Version = { id: string; version_number: number; status: "PUBLISHED" | "DRAFT";
  pdfme_layout: unknown; template_prompt: string | null; extraction_prompt: string | null;
  voice_agent_prompt: string | null; mappings: Mapping[] };
type Template = { id: string; title: string | null; key: TemplateKey; versions: Record<"PUBLISHED" | "DRAFT", Version> };
type Bundle = { templates: Template[] };
type Plan = { source: Environment; target: Environment; sourceHash: string; targetHash: string;
  key: TemplateKey; createdAt: number; receipt?: Record<string, unknown> };

const envSchema = z.enum(["DEV", "STAGING"]);
const familySchema = z.enum(["PURCHASE", "LEASE", "LISTING"]);
const typeSchema = z.enum(["ADDENDA", "CONTRACT", "COUNTEROFFERS", "BBA", "SPDS", "BINSR",
  "PRE_CLOSING_WALKTHROUGH", "LISTING_CONTRACT", "LISTING_ATTACHMENT", "LISTING_POST_EXEC_ATTACHMENT"]);
const schemas: Record<Environment, string> = {
  DEV: "superagent_dev_schema", STAGING: "superagent_staging_schema",
};
const plans = new Map<string, Plan>();
const writers = new Map<Environment, Pool>();
const PLAN_TTL_MS = 15 * 60_000;
const MAX_TEMPLATES = 50;

class PromotionError extends Error {}
function reject(message: string): never { throw new PromotionError(message); }
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
function keyId(key: TemplateKey): string {
  return [key.jurisdiction_code, key.product_family, key.template_type, key.slug ?? ""].join("/");
}
function content(version: Version) {
  return { pdfme_layout: version.pdfme_layout, template_prompt: version.template_prompt,
    extraction_prompt: version.extraction_prompt, voice_agent_prompt: version.voice_agent_prompt,
    mappings: version.mappings };
}
function configuration(template: Template) {
  return { key: template.key, title: template.title,
    published: content(template.versions.PUBLISHED), draft: content(template.versions.DRAFT) };
}
function bundleHash(bundle: Bundle | { templates: Array<Template | null> }): string {
  return hash(bundle.templates);
}
function statusPair(rows: any[], label: string): Record<"PUBLISHED" | "DRAFT", any> {
  const published = rows.filter((row) => row.status === "PUBLISHED");
  const draft = rows.filter((row) => row.status === "DRAFT");
  if (published.length !== 1 || draft.length !== 1 ||
      draft[0].version_number !== published[0].version_number + 1) {
    reject(`${label} must have exactly one current PUBLISHED version and its next DRAFT`);
  }
  return { PUBLISHED: published[0], DRAFT: draft[0] };
}
async function loadTemplate(db: PoolClient, key: TemplateKey, lock = false): Promise<Template | null> {
  const matches = await db.query(`SELECT id, title, jurisdiction_code, product_family, template_type, slug
    FROM contract_template WHERE jurisdiction_code = $1 AND product_family = $2
    AND template_type = $3 AND slug IS NOT DISTINCT FROM $4 AND is_active = true ${lock ? "FOR UPDATE" : ""}`,
    [key.jurisdiction_code, key.product_family, key.template_type, key.slug]);
  if (matches.rows.length > 1) reject(`Ambiguous template ${keyId(key)}`);
  const row = matches.rows[0];
  if (!row) return null;
  const versions = await db.query(`SELECT id, version_number, status, pdfme_layout,
    template_prompt, extraction_prompt, voice_agent_prompt FROM contract_template_version
    WHERE template_id = $1 AND is_active = true AND status IN ('PUBLISHED','DRAFT')
    ORDER BY version_number DESC ${lock ? "FOR UPDATE" : ""}`, [row.id]);
  const pair = statusPair(versions.rows, keyId(key));
  const mapVersion = async (value: any): Promise<Version> => {
    const mappings = await db.query(`SELECT document_type, document_field_id, source_type, source_field_key
      FROM document_field_prefill_mapping WHERE template_version_id = $1 AND is_active = true
      ORDER BY document_type, document_field_id, source_type, source_field_key`, [value.id]);
    return { ...value, mappings: mappings.rows } as Version;
  };
  return { id: row.id, title: row.title,
    key: { jurisdiction_code: row.jurisdiction_code, product_family: row.product_family,
      template_type: row.template_type, slug: row.slug },
    versions: { PUBLISHED: await mapVersion(pair.PUBLISHED), DRAFT: await mapVersion(pair.DRAFT) } };
}

export function referencedTemplateKeys(template: Template): TemplateKey[] {
  const references = new Map<string, TemplateKey>();
  const add = (template_type: string, slug: string) => {
    if (!slug || (template_type === template.key.template_type && slug === template.key.slug)) return;
    const key = { ...template.key, template_type, slug };
    references.set(keyId(key), key);
  };
  for (const version of [template.versions.PUBLISHED, template.versions.DRAFT]) {
    const layout: any = version.pdfme_layout;
    for (const page of Array.isArray(layout?.schemas) ? layout.schemas : []) {
      for (const field of Array.isArray(page) ? page : []) {
        const trigger = typeof field?.triggers_addendum === "string" ? field.triggers_addendum.trim() : "";
        const mapping = typeof field?.addendum_mapping === "string" ? field.addendum_mapping.trim() : "";
        if (trigger) add("ADDENDA", trigger);
        if (mapping.includes(".")) add("ADDENDA", mapping.split(".")[0]);
        if (template.key.product_family === "LISTING") {
          const child = typeof field?.triggers_listing_document === "string"
            ? field.triggers_listing_document.trim() : "";
          const reflection = typeof field?.reflects_listing_document === "string"
            ? field.reflects_listing_document.trim() : "";
          if (child) add("LISTING_ATTACHMENT", child);
          if (reflection) add("LISTING_ATTACHMENT", reflection);
        }
      }
    }
  }
  return [...references.values()].sort((left, right) => keyId(left).localeCompare(keyId(right)));
}

async function loadSourceBundle(db: PoolClient, root: TemplateKey): Promise<Bundle> {
  const ordered: Template[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  async function visit(key: TemplateKey) {
    const id = keyId(key);
    if (done.has(id)) return;
    if (visiting.has(id)) reject(`Cyclic template reference at ${id}`);
    if (done.size + visiting.size >= MAX_TEMPLATES) reject("Promotion exceeds 50 linked templates");
    visiting.add(id);
    const template = await loadTemplate(db, key);
    if (!template) reject(`Source template missing: ${id}`);
    for (const dependency of referencedTemplateKeys(template)) await visit(dependency);
    visiting.delete(id);
    done.add(id);
    ordered.push(template);
  }
  await visit(root);
  return { templates: ordered };
}

async function transaction<T>(environment: Environment, write: boolean,
  fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const envName = environment === "DEV" ? "DEV" : "STAGING";
  const url = process.env[`${write ? "PROMOTION" : "EVIDENCE"}_${envName}_DATABASE_URL`]?.trim();
  if (!url) reject(`${environment} ${write ? "promotion writer" : "evidence reader"} is not configured`);
  let pool: Pool;
  if (write) {
    pool = writers.get(environment) ?? new Pool({ connectionString: url, max: 2,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
      application_name: `superagent_qa_promotion_${environment.toLowerCase()}` });
    writers.set(environment, pool);
  } else {
    pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  }
  let db: PoolClient | undefined;
  try {
    db = await pool.connect();
    await db.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.query("SET LOCAL statement_timeout = '30s'");
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query(`SET LOCAL search_path TO ${schemas[environment]}`);
    const value = await fn(db);
    await db.query("COMMIT");
    return value;
  } catch (error) {
    if (db) await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    db?.release();
    if (!write) await pool.end();
  }
}

async function targetBundle(db: PoolClient, source: Bundle, lock = false) {
  const templates: Array<Template | null> = [];
  for (const template of source.templates) {
    const current = await loadTemplate(db, template.key, lock);
    if (!current) {
      const jurisdiction = await db.query(`SELECT id FROM jurisdiction WHERE code = $1`,
        [template.key.jurisdiction_code]);
      if (jurisdiction.rows.length !== 1) {
        reject(`Target jurisdiction missing: ${template.key.jurisdiction_code}`);
      }
    }
    templates.push(current);
  }
  return { templates };
}
function fieldMap(version: Version): Map<string, string> {
  const map = new Map<string, string>();
  const layout: any = version.pdfme_layout;
  for (const page of Array.isArray(layout?.schemas) ? layout.schemas : []) {
    for (const field of Array.isArray(page) ? page : []) {
      if (typeof field?.name === "string") map.set(field.name, hash(field));
    }
  }
  return map;
}
function changes(source: Bundle, target: { templates: Array<Template | null> }) {
  return source.templates.map((item, index) => {
    const previous = target.templates[index];
    const before = previous ? fieldMap(previous.versions.PUBLISHED) : new Map<string, string>();
    const after = fieldMap(item.versions.PUBLISHED);
    return { template: item.key, action: previous ? "replace_current" : "create",
      source: { published_version: item.versions.PUBLISHED.version_number,
        draft_version: item.versions.DRAFT.version_number,
        published_hash: hash(content(item.versions.PUBLISHED)),
        draft_hash: hash(content(item.versions.DRAFT)) },
      target: previous ? { published_version: previous.versions.PUBLISHED.version_number,
        draft_version: previous.versions.DRAFT.version_number,
        published_hash: hash(content(previous.versions.PUBLISHED)),
        draft_hash: hash(content(previous.versions.DRAFT)) } : null,
      published_fields: { source_count: after.size, target_count: before.size,
        added: [...after.keys()].filter((name) => !before.has(name)),
        removed: [...before.keys()].filter((name) => !after.has(name)),
        changed: [...after.keys()].filter((name) => before.has(name) && before.get(name) !== after.get(name)) },
      source_prefill_mappings: item.versions.PUBLISHED.mappings.length,
      target_prefill_mappings: previous?.versions.PUBLISHED.mappings.length ?? 0,
      component_changes: previous ? {
        title: item.title !== previous.title,
        published_layout: hash(item.versions.PUBLISHED.pdfme_layout) !== hash(previous.versions.PUBLISHED.pdfme_layout),
        draft_layout: hash(item.versions.DRAFT.pdfme_layout) !== hash(previous.versions.DRAFT.pdfme_layout),
        published_template_prompt: item.versions.PUBLISHED.template_prompt !== previous.versions.PUBLISHED.template_prompt,
        published_extraction_prompt: item.versions.PUBLISHED.extraction_prompt !== previous.versions.PUBLISHED.extraction_prompt,
        published_voice_agent_prompt: item.versions.PUBLISHED.voice_agent_prompt !== previous.versions.PUBLISHED.voice_agent_prompt,
        draft_template_prompt: item.versions.DRAFT.template_prompt !== previous.versions.DRAFT.template_prompt,
        draft_extraction_prompt: item.versions.DRAFT.extraction_prompt !== previous.versions.DRAFT.extraction_prompt,
        draft_voice_agent_prompt: item.versions.DRAFT.voice_agent_prompt !== previous.versions.DRAFT.voice_agent_prompt,
        published_prefill_mappings: hash(item.versions.PUBLISHED.mappings) !== hash(previous.versions.PUBLISHED.mappings),
        draft_prefill_mappings: hash(item.versions.DRAFT.mappings) !== hash(previous.versions.DRAFT.mappings),
      } : null,
      target_title: previous?.title ?? null, source_title: item.title };
  });
}

async function insertVersion(db: PoolClient, source: Version, targetTemplateId: string,
  targetJurisdictionId: string, versionNumber: number) {
  const id = randomUUID();
  await db.query(`INSERT INTO contract_template_version
    (id, template_id, version_number, status, pdfme_layout, template_prompt,
     extraction_prompt, voice_agent_prompt, is_active, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,true,NOW(),NOW())`,
    [id, targetTemplateId, versionNumber, source.status,
      source.pdfme_layout == null ? null : JSON.stringify(source.pdfme_layout),
      source.template_prompt, source.extraction_prompt, source.voice_agent_prompt]);
  for (const mapping of source.mappings) {
    await db.query(`INSERT INTO document_field_prefill_mapping
      (id, jurisdiction_id, document_type, template_id, template_version_id,
       document_field_id, source_type, source_field_key, is_active, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW(),NOW())`,
      [randomUUID(), targetJurisdictionId, mapping.document_type, targetTemplateId, id,
        mapping.document_field_id, mapping.source_type, mapping.source_field_key]);
  }
  return { id, version_number: versionNumber, status: source.status };
}

async function replaceBundle(db: PoolClient, source: Bundle,
  before: { templates: Array<Template | null> }) {
  const receipt: Array<Record<string, unknown>> = [];
  for (const [index, item] of source.templates.entries()) {
    const old = before.templates[index];
    const jurisdiction = await db.query(`SELECT id FROM jurisdiction WHERE code = $1`,
      [item.key.jurisdiction_code]);
    if (jurisdiction.rows.length !== 1) reject(`Target jurisdiction missing: ${item.key.jurisdiction_code}`);
    let templateId = old?.id;
    if (templateId) {
      await db.query(`UPDATE contract_template SET title = $2, updated_at = NOW() WHERE id = $1`,
        [templateId, item.title]);
    } else {
      templateId = randomUUID();
      await db.query(`INSERT INTO contract_template
        (id, jurisdiction_code, slug, title, template_type, product_family,
         is_active, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW())`,
        [templateId, item.key.jurisdiction_code, item.key.slug, item.title,
          item.key.template_type, item.key.product_family]);
    }
    const max = await db.query(`SELECT COALESCE(MAX(version_number), 0) AS value
      FROM contract_template_version WHERE template_id = $1`, [templateId]);
    const next = Number(max.rows[0].value) + 1;
    await db.query(`UPDATE contract_template_version SET status = 'DEPRECATED', updated_at = NOW()
      WHERE template_id = $1 AND is_active = true AND status IN ('PUBLISHED','DRAFT')`, [templateId]);
    const published = await insertVersion(db, item.versions.PUBLISHED, templateId,
      jurisdiction.rows[0].id, next);
    const draft = await insertVersion(db, item.versions.DRAFT, templateId,
      jurisdiction.rows[0].id, next + 1);
    const actual = await loadTemplate(db, item.key);
    if (!actual || hash(configuration(actual)) !== hash(configuration(item))) {
      reject(`Post-write parity failed for ${keyId(item.key)}`);
    }
    receipt.push({ template: item.key, target_template_id: templateId,
      published, draft, previous_published_id: old?.versions.PUBLISHED.id ?? null,
      previous_draft_id: old?.versions.DRAFT.id ?? null });
  }
  return receipt;
}

async function refreshCache(environment: Environment) {
  const baseUrl = process.env[`EVIDENCE_${environment}_BACKEND_URL`]?.trim();
  const token = process.env[`PROMOTION_${environment}_BACKEND_TOKEN`]?.trim();
  if (!baseUrl || !token) reject(`${environment} promotion cache refresh is not configured`);
  const base = new URL(baseUrl);
  if (!/^https?:$/.test(base.protocol)) reject("Invalid backend URL");
  const path = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  const endpoint = new URL("v1/admin/cache/templates/refresh", new URL(path, base));
  const response = await fetch(endpoint, { method: "POST",
    headers: { "X-QA-Template-Promotion-Token": token }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Cache refresh failed");
  return response.json();
}
function toolError(error: unknown) {
  const message = error instanceof PromotionError ? error.message : "Template promotion failed; inspect server logs";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
async function toolSafe(fn: () => Promise<unknown>) {
  try { return result(await fn()); } catch (error) { return toolError(error); }
}
function getPlan(id: string): Plan {
  const plan = plans.get(id);
  if (!plan || Date.now() - plan.createdAt > (plan.receipt ? 24 * 60 * 60_000 : PLAN_TTL_MS)) {
    reject("Promotion plan expired; run preview again");
  }
  return plan;
}
function trimPlans() {
  for (const [id, plan] of plans) {
    if (Date.now() - plan.createdAt > (plan.receipt ? 24 * 60 * 60_000 : PLAN_TTL_MS)) plans.delete(id);
  }
  if (plans.size > 100) plans.delete(plans.keys().next().value!);
}

export function registerTemplatePromotionTools(server: McpServer) {
  server.tool("qa_template_promotion_preview",
    "Preview an exact DEV/STAGING template configuration replacement and linked child templates; excludes prompt library",
    { source_environment: envSchema, target_environment: envSchema,
      jurisdiction_code: z.string().regex(/^[A-Z0-9]{2,16}$/), product_family: familySchema,
      template_type: typeSchema, slug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/).nullable() },
    async (a) => toolSafe(async () => {
      if (a.source_environment === a.target_environment) reject("Source and target must differ");
      const key: TemplateKey = { jurisdiction_code: a.jurisdiction_code,
        product_family: a.product_family, template_type: a.template_type, slug: a.slug };
      const source = await transaction(a.source_environment, false, (db) => loadSourceBundle(db, key));
      const target = await transaction(a.target_environment, false, (db) => targetBundle(db, source));
      const planId = randomUUID();
      trimPlans();
      plans.set(planId, { source: a.source_environment, target: a.target_environment,
        sourceHash: bundleHash(source), targetHash: bundleHash(target), key, createdAt: Date.now() });
      return { plan_id: planId, expires_in_seconds: PLAN_TTL_MS / 1000,
        source_environment: a.source_environment, target_environment: a.target_environment,
        production_target: a.target_environment === "STAGING", source_hash: bundleHash(source),
        target_hash: bundleHash(target), changes: changes(source, target),
        already_equal: source.templates.every((item, index) => {
          const current = target.templates[index];
          return current && hash(configuration(item)) === hash(configuration(current));
        }),
        included: "Template identity/title, current published and draft layout, base PDF, prompts, fields, mappings, and linked child templates",
        excluded: "NewVoice prompt library, historical versions, documents, calls, user data",
        apply_configured: Boolean(process.env[`PROMOTION_${a.target_environment}_DATABASE_URL`] &&
          process.env[`PROMOTION_${a.target_environment}_BACKEND_TOKEN`] &&
          process.env[`EVIDENCE_${a.target_environment}_BACKEND_URL`]) };
    }));

  server.tool("qa_template_promotion_apply",
    "Apply a fresh promotion preview atomically to the target; preserves historical versions and refreshes template caches",
    { plan_id: z.string().uuid(), expected_source_hash: z.string().length(64),
      expected_target_hash: z.string().length(64) },
    async (a) => toolSafe(async () => {
      const plan = getPlan(a.plan_id);
      if (a.expected_source_hash !== plan.sourceHash || a.expected_target_hash !== plan.targetHash) {
        reject("Promotion hashes do not match the preview");
      }
      if (plan.receipt) {
        if (plan.receipt.cache_refresh === "ok") return plan.receipt;
        try {
          const cache = await refreshCache(plan.target);
          plan.receipt = { ...plan.receipt, cache_refresh: "ok", cache };
        } catch {
          plan.receipt = { ...plan.receipt, cache_refresh: "failed" };
        }
        return plan.receipt;
      }
      if (!process.env[`PROMOTION_${plan.target}_DATABASE_URL`] ||
          !process.env[`PROMOTION_${plan.target}_BACKEND_TOKEN`] ||
          !process.env[`EVIDENCE_${plan.target}_BACKEND_URL`]) {
        reject(`${plan.target} promotion writer or cache refresh is not configured`);
      }
      const source = await transaction(plan.source, false, (db) => loadSourceBundle(db, plan.key));
      if (bundleHash(source) !== plan.sourceHash) reject("Source changed since preview; run preview again");
      const applied = await transaction(plan.target, true, async (db) => {
        const before = await targetBundle(db, source, true);
        if (bundleHash(before) !== plan.targetHash) reject("Target changed since preview; run preview again");
        const alreadyEqual = source.templates.every((item, index) => {
          const current = before.templates[index];
          return current && hash(configuration(item)) === hash(configuration(current));
        });
        return alreadyEqual ? { changed: false, templates: [] }
          : { changed: true, templates: await replaceBundle(db, source, before) };
      });
      plan.receipt = { plan_id: a.plan_id, source_environment: plan.source,
        target_environment: plan.target, committed: applied.changed,
        already_equal: !applied.changed, templates: applied.templates,
        source_hash: plan.sourceHash, previous_target_hash: plan.targetHash,
        cache_refresh: "pending" };
      try {
        const cache = await refreshCache(plan.target);
        plan.receipt = { ...plan.receipt, cache_refresh: "ok", cache };
      } catch {
        plan.receipt = { ...plan.receipt, cache_refresh: "failed",
          cache_note: "Database committed. Retry this apply plan to refresh cache; do not run a new promotion." };
      }
      return plan.receipt;
    }));

  server.tool("qa_template_promotion_cache_refresh",
    "Retry target template cache refresh after a committed promotion",
    { environment: envSchema },
    async (a) => toolSafe(async () => ({ environment: a.environment,
      refreshed: true, cache: await refreshCache(a.environment) })));
}
