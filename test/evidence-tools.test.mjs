import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("evidence tools register with explicit environment and report source availability", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, MCP_TRANSPORT: "stdio",
      EVIDENCE_DEV_DATABASE_URL: "", EVIDENCE_STAGING_DATABASE_URL: "",
      EVIDENCE_DEV_BACKEND_URL: "", EVIDENCE_STAGING_BACKEND_URL: "" },
  });
  const client = new Client({ name: "evidence-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const list = tools.find((tool) => tool.name === "qa_rooms_list");
    assert.deepEqual(list?.inputSchema.required?.includes("environment"), true);
    for (const name of ["qa_room_get", "qa_room_debug_get", "qa_room_trace_get",
      "qa_room_events_list", "qa_room_logs_get", "qa_room_fields_get",
      "qa_templates_list", "qa_template_version_get",
      "qa_template_promotion_preview", "qa_template_promotion_apply",
      "qa_template_promotion_cache_refresh"]) {
      assert.ok(tools.some((tool) => tool.name === name), name);
    }
    const result = await client.callTool({ name: "qa_data_capabilities_get", arguments: {} });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.environments[1].environment, "STAGING");
    assert.equal(payload.environments[1].production_data, true);
    assert.equal(payload.environments[0].database, false);
    const unavailable = await client.callTool({ name: "qa_rooms_list",
      arguments: { environment: "STAGING" } });
    assert.equal(unavailable.isError, true);
    assert.match(unavailable.content[0].text, /STAGING evidence database is not configured/);
    const rejected = await client.callTool({ name: "qa_template_promotion_preview", arguments: {
      source_environment: "DEV", target_environment: "DEV", jurisdiction_code: "AZ",
      product_family: "LEASE", template_type: "CONTRACT", slug: "residential-lease",
    } });
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /Source and target must differ/);
  } finally {
    await client.close();
  }
});
