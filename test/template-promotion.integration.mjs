// Run explicitly against an isolated local PostgreSQL cluster on port 55432.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import pg from "pg";

const databaseUrl = process.env.PROMOTION_TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== "127.0.0.1"
    || new URL(databaseUrl).port !== "55432") {
  throw new Error("PROMOTION_TEST_DATABASE_URL must point to isolated 127.0.0.1:55432");
}

const { Pool } = pg;
const sourceSchema = "superagent_dev_schema";
const targetSchema = "superagent_staging_schema";
const ids = {
  sourceTemplate: "00000000-0000-4000-8000-000000000101",
  childTemplate: "00000000-0000-4000-8000-000000000102",
  targetTemplate: "00000000-0000-4000-8000-000000000201",
  oldPublished: "00000000-0000-4000-8000-000000000211",
};

async function schema(db, name, jurisdictionId) {
  await db.query(`CREATE SCHEMA ${name}`);
  await db.query(`CREATE TABLE ${name}.jurisdiction (id uuid PRIMARY KEY, code varchar(16) UNIQUE NOT NULL)`);
  await db.query(`CREATE TABLE ${name}.contract_template (
    id uuid PRIMARY KEY, jurisdiction_code varchar(16) NOT NULL REFERENCES ${name}.jurisdiction(code),
    slug varchar(128), title varchar(256), template_type varchar(32) NOT NULL,
    product_family varchar(16) NOT NULL, is_active boolean NOT NULL DEFAULT true,
    created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`);
  await db.query(`CREATE UNIQUE INDEX ON ${name}.contract_template
    (jurisdiction_code, product_family, template_type, COALESCE(slug, '')) WHERE is_active = true`);
  await db.query(`CREATE TABLE ${name}.contract_template_version (
    id uuid PRIMARY KEY, template_id uuid NOT NULL REFERENCES ${name}.contract_template(id),
    version_number int NOT NULL, status varchar(32) NOT NULL, pdfme_layout jsonb,
    template_prompt text, extraction_prompt text, voice_agent_prompt text,
    is_active boolean NOT NULL DEFAULT true, created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(), UNIQUE(template_id, version_number))`);
  await db.query(`CREATE TABLE ${name}.document_field_prefill_mapping (
    id uuid PRIMARY KEY, jurisdiction_id uuid NOT NULL REFERENCES ${name}.jurisdiction(id),
    document_type varchar(32) NOT NULL, template_id uuid NOT NULL REFERENCES ${name}.contract_template(id),
    template_version_id uuid NOT NULL REFERENCES ${name}.contract_template_version(id),
    document_field_id varchar(255) NOT NULL, source_type varchar(16) NOT NULL,
    source_field_key varchar(255) NOT NULL, is_active boolean NOT NULL DEFAULT true,
    created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`);
  await db.query(`INSERT INTO ${name}.jurisdiction(id,code) VALUES ($1,'AZ')`, [jurisdictionId]);
}

async function template(db, name, id, slug, title, type, publishedNumber, publishedId, layout, draftLayout) {
  await db.query(`INSERT INTO ${name}.contract_template
    (id,jurisdiction_code,slug,title,template_type,product_family)
    VALUES ($1,'AZ',$2,$3,$4,'LEASE')`, [id, slug, title, type]);
  for (const [index, currentLayout] of [layout, draftLayout].entries()) {
    const versionId = index === 0 ? publishedId : publishedId.replace(/.$/, "2");
    await db.query(`INSERT INTO ${name}.contract_template_version
      (id,template_id,version_number,status,pdfme_layout,template_prompt,
       extraction_prompt,voice_agent_prompt)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [versionId, id, publishedNumber + index, index ? "DRAFT" : "PUBLISHED",
        JSON.stringify(currentLayout), `document-${slug}-${index}`, `extract-${slug}-${index}`,
        `voice-${slug}-${index}`]);
  }
}

function parsed(result) { return JSON.parse(result.content[0].text); }

test("preview and apply promote linked Lease configuration without repointing historical documents", async () => {
  const db = new Pool({ connectionString: databaseUrl });
  let client;
  let mock;
  try {
    await db.query(`DROP SCHEMA IF EXISTS ${sourceSchema} CASCADE`);
    await db.query(`DROP SCHEMA IF EXISTS ${targetSchema} CASCADE`);
    await schema(db, sourceSchema, "00000000-0000-4000-8000-000000000001");
    await schema(db, targetSchema, "00000000-0000-4000-8000-000000000002");
    const sourceLayout = { basePdf: "embedded-pdf", schemas: [[
      { name: "pet", type: "checkbox", triggers_addendum: "pet-addendum" },
      { name: "tenant_name", type: "text" },
    ]] };
    await template(db, sourceSchema, ids.sourceTemplate, null, "Residential Lease",
      "CONTRACT", 1, "00000000-0000-4000-8000-000000000111", sourceLayout,
      { ...sourceLayout, schemas: [[...sourceLayout.schemas[0], { name: "rent", type: "text" }]] });
    await template(db, sourceSchema, ids.childTemplate, "pet-addendum", "Pet Addendum",
      "ADDENDA", 1, "00000000-0000-4000-8000-000000000121",
      { schemas: [[{ name: "pet_name", type: "text" }]] },
      { schemas: [[{ name: "pet_name", type: "text" }]] });
    await db.query(`INSERT INTO ${sourceSchema}.document_field_prefill_mapping
      (id,jurisdiction_id,document_type,template_id,template_version_id,
       document_field_id,source_type,source_field_key)
      VALUES ('00000000-0000-4000-8000-000000000131',
        '00000000-0000-4000-8000-000000000001','CONTRACT',$1,
        '00000000-0000-4000-8000-000000000111','tenant_name','AGENT','agent_name')`,
      [ids.sourceTemplate]);
    await template(db, targetSchema, ids.targetTemplate, null, "Old Lease",
      "CONTRACT", 4, ids.oldPublished,
      { schemas: [[{ name: "old_field", type: "text" }]] },
      { schemas: [[{ name: "old_field", type: "text" }]] });
    await db.query(`INSERT INTO ${targetSchema}.contract_template
      (id,jurisdiction_code,slug,title,template_type,product_family)
      VALUES ('00000000-0000-4000-8000-000000000203','AZ','pet-addendum',
        'Purchase Pet Addendum','ADDENDA','PURCHASE')`);
    await db.query(`CREATE TABLE ${targetSchema}.contract_document (
      id uuid PRIMARY KEY, template_version_id uuid REFERENCES ${targetSchema}.contract_template_version(id))`);
    await db.query(`INSERT INTO ${targetSchema}.contract_document VALUES
      ('00000000-0000-4000-8000-000000000301',$1)`, [ids.oldPublished]);

    let failRefresh = false;
    mock = createServer((request, response) => {
      assert.equal(request.url, "/api/v1/admin/cache/templates/refresh");
      assert.equal(request.method, "POST");
      assert.equal(request.headers["x-qa-template-promotion-token"], "promotion-test-token");
      response.writeHead(failRefresh ? 503 : 200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ clearedCaches: ["template-versions", "pdfme-layout"] }));
    });
    await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
    const backendUrl = `http://127.0.0.1:${mock.address().port}/api/`;
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ["dist/index.js"], env: { ...process.env, MCP_TRANSPORT: "stdio",
        EVIDENCE_DEV_DATABASE_URL: databaseUrl, EVIDENCE_STAGING_DATABASE_URL: databaseUrl,
        PROMOTION_DEV_DATABASE_URL: databaseUrl, PROMOTION_STAGING_DATABASE_URL: databaseUrl,
        EVIDENCE_DEV_BACKEND_URL: backendUrl, EVIDENCE_STAGING_BACKEND_URL: backendUrl,
        PROMOTION_DEV_BACKEND_TOKEN: "promotion-test-token",
        PROMOTION_STAGING_BACKEND_TOKEN: "promotion-test-token" } });
    client = new Client({ name: "promotion-integration", version: "1.0.0" });
    await client.connect(transport);
    const args = { source_environment: "DEV", target_environment: "STAGING",
      jurisdiction_code: "AZ", product_family: "LEASE", template_type: "CONTRACT",
      slug: null };
    const preview = parsed(await client.callTool({ name: "qa_template_promotion_preview", arguments: args }));
    assert.equal(preview.changes.length, 2);
    assert.equal(preview.changes[0].template.slug, "pet-addendum");
    assert.equal(preview.changes[0].action, "create");
    assert.equal(preview.changes[1].action, "replace_current");
    assert.equal(preview.changes[1].component_changes.published_layout, true);
    const apply = parsed(await client.callTool({ name: "qa_template_promotion_apply", arguments: {
      plan_id: preview.plan_id, expected_source_hash: preview.source_hash,
      expected_target_hash: preview.target_hash } }));
    assert.equal(apply.committed, true);
    assert.equal(apply.cache_refresh, "ok");
    assert.equal(apply.templates.length, 2);
    const old = await db.query(`SELECT status FROM ${targetSchema}.contract_template_version WHERE id=$1`,
      [ids.oldPublished]);
    assert.equal(old.rows[0].status, "DEPRECATED");
    const historical = await db.query(`SELECT template_version_id FROM ${targetSchema}.contract_document`);
    assert.equal(historical.rows[0].template_version_id, ids.oldPublished);
    const current = await db.query(`SELECT version_number, pdfme_layout FROM
      ${targetSchema}.contract_template_version WHERE template_id=$1 AND status='PUBLISHED'`,
      [ids.targetTemplate]);
    assert.equal(current.rows[0].version_number, 6);
    assert.deepEqual(current.rows[0].pdfme_layout, sourceLayout);
    const copiedMapping = await db.query(`SELECT jurisdiction_id, document_field_id FROM
      ${targetSchema}.document_field_prefill_mapping WHERE template_version_id=$1`,
      [apply.templates[1].published.id]);
    assert.equal(copiedMapping.rows[0].jurisdiction_id, "00000000-0000-4000-8000-000000000002");
    assert.equal(copiedMapping.rows[0].document_field_id, "tenant_name");
    const repeat = parsed(await client.callTool({ name: "qa_template_promotion_apply", arguments: {
      plan_id: preview.plan_id, expected_source_hash: preview.source_hash,
      expected_target_hash: preview.target_hash } }));
    assert.deepEqual(repeat, apply);
    const equalPreview = parsed(await client.callTool({ name: "qa_template_promotion_preview", arguments: args }));
    failRefresh = true;
    const noOp = parsed(await client.callTool({ name: "qa_template_promotion_apply", arguments: {
      plan_id: equalPreview.plan_id, expected_source_hash: equalPreview.source_hash,
      expected_target_hash: equalPreview.target_hash } }));
    assert.equal(noOp.committed, false);
    assert.equal(noOp.already_equal, true);
    assert.equal(noOp.cache_refresh, "failed");
    failRefresh = false;
    const recovered = parsed(await client.callTool({ name: "qa_template_promotion_apply", arguments: {
      plan_id: equalPreview.plan_id, expected_source_hash: equalPreview.source_hash,
      expected_target_hash: equalPreview.target_hash } }));
    assert.equal(recovered.cache_refresh, "ok");
    const manualRefresh = parsed(await client.callTool({ name: "qa_template_promotion_cache_refresh",
      arguments: { environment: "STAGING" } }));
    assert.equal(manualRefresh.refreshed, true);
    const currentCount = await db.query(`SELECT COUNT(*)::int AS count FROM
      ${targetSchema}.contract_template_version WHERE template_id=$1`, [ids.targetTemplate]);
    assert.equal(currentCount.rows[0].count, 4);
    const stale = parsed(await client.callTool({ name: "qa_template_promotion_preview", arguments: args }));
    await db.query(`UPDATE ${targetSchema}.contract_template SET title='concurrent edit'
      WHERE id=$1`, [ids.targetTemplate]);
    const rejected = await client.callTool({ name: "qa_template_promotion_apply", arguments: {
      plan_id: stale.plan_id, expected_source_hash: stale.source_hash,
      expected_target_hash: stale.target_hash } });
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /Target changed since preview/);
  } finally {
    await client?.close();
    if (mock) await new Promise((resolve) => mock.close(resolve));
    await db.query(`DROP SCHEMA IF EXISTS ${sourceSchema} CASCADE`);
    await db.query(`DROP SCHEMA IF EXISTS ${targetSchema} CASCADE`);
    await db.end();
  }
});
