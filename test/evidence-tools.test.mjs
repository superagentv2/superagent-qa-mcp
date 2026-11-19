import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
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
      "qa_text_users_list", "qa_text_user_links_list", "qa_text_link_get",
      "qa_text_interactions_list", "qa_text_interaction_get", "qa_text_debug_link_get",
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

test("text evidence tools use bounded backend reads and resolve copied interaction links", async () => {
  const requests = [];
  const backend = createServer((request, response) => {
    requests.push({ path: request.url, method: request.method,
      token: request.headers["x-qa-evidence-token"] });
    const path = new URL(request.url, "http://localhost").pathname;
    const payload = path.endsWith("/users")
      ? { content: [{ userClerkId: "user_123", sessionCount: 1 }], page: 0, size: 25, hasNext: false }
      : path.endsWith("/sessions")
        ? { content: [{ id: 42, userClerkId: "user_123", senderId: "sender_1" }], hasNext: false }
        : path.endsWith("/42/episodes")
          ? [{ connectionId: "episode-1", unlinkedAt: null }]
          : path.endsWith("/42/messages/99")
            ? { id: 99, inboundText: "hello", responseText: "hi",
              trace: { events: [{ kind: "tool_call" }] }, events: [] }
            : path.endsWith("/42/messages")
              ? { content: [{ id: 99, inboundText: "hello" }], page: 1, size: 25,
                hasNext: false, anchorId: 99 }
              : path.endsWith("/42")
                ? { id: 42, userClerkId: "user_123", senderId: "sender_1" }
                : null;
    response.setHeader("Content-Type", "application/json");
    response.statusCode = payload === null ? 404 : 200;
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = backend.address().port;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, MCP_TRANSPORT: "stdio", EVIDENCE_DEV_DATABASE_URL: "",
      EVIDENCE_DEV_BACKEND_URL: `http://127.0.0.1:${port}/api`,
      EVIDENCE_DEV_BACKEND_TOKEN: "test-evidence-token" },
  });
  const client = new Client({ name: "text-evidence-test", version: "1.0.0" });
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: { environment: "DEV", ...args } });
    assert.equal(result.isError, undefined, `${name}: ${result.content[0]?.text}`);
    return JSON.parse(result.content[0].text);
  };
  try {
    await client.connect(transport);
    assert.equal((await call("qa_text_users_list", {})).content[0].userClerkId, "user_123");
    assert.equal((await call("qa_text_user_links_list", { user_clerk_id: "user_123" })).content[0].id, 42);
    assert.equal((await call("qa_text_link_get", { session_id: 42 })).episodes.length, 1);
    assert.equal((await call("qa_text_interactions_list", { session_id: 42, page: 1,
      anchor_id: 99 })).anchorId, 99);
    assert.equal((await call("qa_text_interaction_get", { session_id: 42,
      message_id: 99 })).interaction.trace.events[0].kind, "tool_call");
    const resolved = await call("qa_text_debug_link_get", { debug_url:
      "https://front-dev.superagent.estate/admin/text-sessions/user_123/42?message=99" });
    assert.equal(resolved.interaction.id, 99);
    assert.equal(resolved.session.userClerkId, "user_123");
    const senderOnly = await call("qa_text_debug_link_get", { debug_url:
      "https://front-dev.superagent.estate/admin/text-sessions/user_123/42" });
    assert.equal(senderOnly.session.id, 42);
    assert.equal("interaction" in senderOnly, false);
    assert.ok(requests.some(({ path }) => path.includes("page=1&size=25&anchorId=99")));
    assert.ok(requests.every(({ method, token }) => method === "GET" && token === "test-evidence-token"));
    const invalid = await client.callTool({ name: "qa_text_debug_link_get", arguments: {
      environment: "DEV", debug_url: "https://example.test/admin/text-sessions/user_123/42?message=99&message=100",
    } });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /Invalid text session debug link/);
    const wrongOwner = await client.callTool({ name: "qa_text_debug_link_get", arguments: {
      environment: "DEV", debug_url: "https://example.test/admin/text-sessions/user_wrong/42?message=99",
    } });
    assert.equal(wrongOwner.isError, true);
    assert.match(wrongOwner.content[0].text, /Invalid text session debug link/);
  } finally {
    await client.close();
    await new Promise((resolve) => backend.close(resolve));
  }
});
