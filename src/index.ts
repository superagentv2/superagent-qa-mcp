#!/usr/bin/env node

import { randomUUID, timingSafeEqual } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { errorMessage, logEvent, redactUrl, responseByteLength, withLogContext } from "./logger.js";
import { QaRunnerClient } from "./qa-client.js";

const config = loadConfig();
const qa = new QaRunnerClient(config);

function createQaMcpServer() {
const server = new McpServer({
  name: "superagent-qa-mcp",
  version: "0.1.0",
});
const originalTool = server.tool.bind(server) as (...args: any[]) => unknown;
(server as any).tool = (...args: any[]) => {
  const callbackIndex = args.length - 1;
  const callback = args[callbackIndex];
  const toolName = String(args[0] ?? "unknown_tool");
  if (typeof callback !== "function") return originalTool(...args);

  args[callbackIndex] = async (...callbackArgs: any[]) => {
    const requestId = randomUUID();
    const started = performance.now();
    const firstArg = callbackArgs[0];
    const argKeys =
      firstArg && typeof firstArg === "object" && !Array.isArray(firstArg)
        ? Object.keys(firstArg).sort().join(",")
        : "";

    return withLogContext({ request_id: requestId, tool: toolName }, async () => {
      logEvent("mcp_tool_start", { arg_keys: argKeys });
      try {
        const result = await callback(...callbackArgs);
        const isToolError = Boolean((result as { isError?: boolean } | undefined)?.isError);
        logEvent("mcp_tool_end", {
          status: isToolError ? "tool_error" : "ok",
          duration_ms: Math.round(performance.now() - started),
          response_bytes: responseByteLength(result),
        });
        return result;
      } catch (error) {
        logEvent("mcp_tool_error", {
          status: "exception",
          duration_ms: Math.round(performance.now() - started),
          error: errorMessage(error).slice(0, 1000),
        });
        throw error;
      }
    });
  };

  return originalTool(...args);
};

const boolDefault = (value: boolean) => z.boolean().default(value);
const intDefault = (value: number, min = 1, max = 500) =>
  z.number().int().min(min).max(max).default(value);
const optionalHash = z.string().optional();
const requirementsWriteQuery = { include_coverage: false };

const runOptionsSchema = {
  cleanup: boolDefault(true),
  saveLog: boolDefault(true),
  repeat: intDefault(1, 1, 20),
  minPassRate: z.number().min(0).max(1).default(1),
  triageReport: boolDefault(true),
  jobs: intDefault(1, 1, 16),
};

const suiteRunOptionsSchema = {
  cleanup: boolDefault(true),
  saveLog: boolDefault(true),
  triageReport: boolDefault(true),
  jobs: intDefault(1, 1, 16),
};

const requirementSchema = z.object({
  id: z.string(),
  summary: z.string(),
  detailed_description: z.string().optional(),
  section_id: z.string().optional(),
  section_title: z.string().optional(),
  priority: z.string().default("p1"),
  required_evidence: z.array(z.object({ test_type: z.string() })).optional(),
  legacy_status: z.string().optional(),
  next_action: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

function jsonText(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function plainText(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function encode(value: string) {
  return encodeURIComponent(value);
}

function snakeRunOptions(args: {
  cleanup: boolean;
  saveLog: boolean;
  repeat?: number;
  minPassRate?: number;
  triageReport?: boolean;
  jobs?: number;
}) {
  return {
    cleanup: args.cleanup,
    save_log: args.saveLog,
    repeat: args.repeat ?? 1,
    min_pass_rate: args.minPassRate ?? 1,
    triage_report: args.triageReport ?? true,
    jobs: args.jobs ?? 1,
  };
}

function snakeSuiteOptions(args: {
  cleanup: boolean;
  saveLog: boolean;
  triageReport: boolean;
  jobs: number;
}) {
  return {
    cleanup: args.cleanup,
    save_log: args.saveLog,
    triage_report: args.triageReport,
    jobs: args.jobs,
  };
}

server.registerResource(
  "qa_health",
  "qa://health",
  {
    title: "QA Runner Health",
    mimeType: "application/json",
    description: "Current QA runner health response.",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await qa.get("/health"), null, 2) }],
  })
);

server.registerResource(
  "qa_manifest_az",
  "qa://manifest/AZ",
  {
    title: "QA Manifest AZ",
    mimeType: "application/json",
    description: "QA manifest for Arizona generation and validation.",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(await qa.get("/eval/manifest", { jurisdictionCode: "AZ" }), null, 2),
      },
    ],
  })
);

server.registerResource(
  "qa_catalog",
  "qa://catalog",
  {
    title: "QA Catalog",
    mimeType: "application/json",
    description: "Normalized QA catalog response.",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await qa.get("/eval/catalog"), null, 2) }],
  })
);

server.registerResource(
  "qa_file_tree",
  "qa://files/tree",
  {
    title: "QA File Tree",
    mimeType: "application/json",
    description: "Explorer tree rooted at simulations/ including references.",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await qa.get("/eval/files/tree"), null, 2) }],
  })
);

server.registerResource(
  "qa_requirements",
  "qa://requirements",
  {
    title: "QA Requirements",
    mimeType: "application/json",
    description: "Requirements and coverage metadata.",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await qa.get("/eval/requirements"), null, 2) }],
  })
);

server.registerResource(
  "qa_coverage",
  "qa://coverage",
  {
    title: "QA Coverage",
    mimeType: "application/json",
    description: "Computed QA coverage graph.",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await qa.get("/eval/coverage"), null, 2) }],
  })
);

server.tool("qa_health_get", "Check whether the QA runner API is reachable.", {}, async () => {
  return jsonText(await qa.get("/health"));
});

server.tool(
  "qa_manifest_get",
  "Fetch the QA manifest used for generation and validation.",
  { jurisdictionCode: z.string().default("AZ") },
  async ({ jurisdictionCode }) => jsonText(await qa.get("/eval/manifest", { jurisdictionCode }))
);

server.tool("qa_catalog_get", "Fetch the normalized QA catalog.", {}, async () => {
  return jsonText(await qa.get("/eval/catalog"));
});

server.tool(
  "qa_catalog_search",
  "Search normalized QA catalog rows.",
  {
    q: z.string().optional(),
    testType: z.string().optional(),
    bucket: z.string().optional(),
    runner: z.string().optional(),
    lane: z.string().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    runnable: z.boolean().optional(),
    editable: z.boolean().optional(),
    sort: z.string().optional(),
    page: intDefault(1, 1, 10000),
    perPage: intDefault(25, 1, 500),
  },
  async (args) =>
    jsonText(
      await qa.get("/eval/tests", {
        q: args.q,
        test_type: args.testType,
        bucket: args.bucket,
        runner: args.runner,
        lane: args.lane,
        status: args.status,
        priority: args.priority,
        runnable: args.runnable,
        editable: args.editable,
        sort: args.sort,
        page: args.page,
        per_page: args.perPage,
      })
    )
);

server.tool(
  "qa_definition_get",
  "Read a YAML test definition by catalog test id.",
  { testId: z.string() },
  async ({ testId }) => jsonText(await qa.get(`/eval/tests/${encode(testId)}/definition`))
);

server.tool(
  "qa_definition_save",
  "Save a YAML test definition with optimistic locking.",
  {
    testId: z.string(),
    yaml: z.string(),
    expectedHash: optionalHash,
  },
  async ({ testId, yaml, expectedHash }) =>
    jsonText(
      await qa.put(`/eval/tests/${encode(testId)}/definition`, {
        yaml,
        expected_hash: expectedHash,
      })
    )
);

server.tool(
  "qa_lint_definition",
  "Lint a YAML test definition draft.",
  {
    yaml: z.string(),
    testType: z.string().default("replay"),
    jurisdictionCode: z.string().default("AZ"),
  },
  async ({ yaml, testType, jurisdictionCode }) =>
    jsonText(
      await qa.post("/eval/validate-scenario-draft", {
        yaml,
        test_type: testType,
        jurisdiction_code: jurisdictionCode,
      })
    )
);

server.tool(
  "qa_draft_generate",
  "Generate a manifest-grounded draft from natural language.",
  {
    description: z.string(),
    testType: z.string().default("replay"),
    contractType: z.string().default("purchase"),
    jurisdictionCode: z.string().default("AZ"),
    model: z.string().optional(),
  },
  async ({ description, testType, contractType, jurisdictionCode, model }) =>
    jsonText(
      await qa.post("/eval/generate-scenario-draft", {
        description,
        test_type: testType,
        contract_type: contractType,
        jurisdiction_code: jurisdictionCode,
        model,
      })
    )
);

server.tool(
  "qa_draft_create",
  "Create a draft YAML test file.",
  {
    testType: z.string(),
    yaml: z.string(),
    id: z.string().optional(),
    path: z.string().optional(),
  },
  async ({ testType, yaml, id, path }) =>
    jsonText(await qa.post("/eval/tests/drafts", { test_type: testType, yaml, id, path }))
);

server.tool(
  "qa_lifecycle_set",
  "Set QA lifecycle status for a test.",
  {
    testId: z.string(),
    qaStatus: z.enum(["draft", "reviewed", "promoted", "archived"]),
  },
  async ({ testId, qaStatus }) =>
    jsonText(await qa.post(`/eval/tests/${encode(testId)}/lifecycle`, { qa_status: qaStatus }))
);

server.tool(
  "qa_archive",
  "Archive a test definition.",
  {
    testId: z.string(),
    expectedHash: optionalHash,
  },
  async ({ testId, expectedHash }) =>
    jsonText(
      await qa.post(`/eval/tests/${encode(testId)}/archive`, {
        yaml: "",
        expected_hash: expectedHash,
      })
    )
);

server.tool(
  "qa_files_list",
  "List direct children under a simulations path.",
  { path: z.string().default("simulations") },
  async ({ path }) => jsonText(await qa.get("/eval/files", { path }))
);

server.tool("qa_files_tree_get", "Fetch the full simulations explorer tree.", {}, async () => {
  return jsonText(await qa.get("/eval/files/tree"));
});

server.tool(
  "qa_file_content_get",
  "Read raw file content from the QA explorer.",
  { path: z.string() },
  async ({ path }) => jsonText(await qa.get("/eval/files/content", { path }))
);

server.tool(
  "qa_file_content_save",
  "Save an existing snapshot JSON artifact with optimistic locking. Editing generated JSON marks its bundle manually modified; prefer recipe generation for normal changes.",
  {
    path: z.string(),
    content: z.string(),
    expectedHash: optionalHash,
  },
  async ({ path, content, expectedHash }) =>
    jsonText(await qa.put("/eval/files/content", { content, expected_hash: expectedHash }, { path }))
);

server.tool(
  "qa_folder_create",
  "Create a folder under simulations/.",
  {
    path: z.string().default("simulations"),
    name: z.string(),
  },
  async ({ path, name }) => jsonText(await qa.post("/eval/files/folders", { path, name }))
);

server.tool(
  "qa_snapshot_bundle_create",
  "Create a pending snapshot bundle with a replay recipe and no placeholder JSON artifact.",
  {
    path: z.string().default("simulations/microtests/snapshots"),
    name: z.string(),
    recipeYaml: z.string().optional(),
  },
  async ({ path, name, recipeYaml }) =>
    jsonText(
      await qa.post("/eval/snapshot-bundles", {
        path,
        name,
        recipe_yaml: recipeYaml,
      })
    )
);

server.tool(
  "qa_snapshot_bundle_get",
  "Read a snapshot bundle, including its recipe, generated JSON, status, metadata, and consumers.",
  { bundleId: z.string() },
  async ({ bundleId }) =>
    jsonText(await qa.get(`/eval/snapshot-bundles/${encode(bundleId)}`))
);

server.tool(
  "qa_snapshot_recipe_validate",
  "Validate and lint snapshot recipe YAML without saving it. Check save_allowed in the response before saving or generating.",
  {
    bundleId: z.string(),
    yaml: z.string(),
  },
  async ({ bundleId, yaml }) =>
    jsonText(
      await qa.post(`/eval/snapshot-bundles/${encode(bundleId)}/recipe/validate`, {
        yaml,
      })
    )
);

server.tool(
  "qa_snapshot_recipe_save",
  "Save snapshot recipe YAML with optimistic locking. Saving may return lint diagnostics; generation remains lint-gated.",
  {
    bundleId: z.string(),
    yaml: z.string(),
    expectedHash: optionalHash,
  },
  async ({ bundleId, yaml, expectedHash }) =>
    jsonText(
      await qa.put(`/eval/snapshot-bundles/${encode(bundleId)}/recipe`, {
        yaml,
        expected_hash: expectedHash,
      })
    )
);

server.tool(
  "qa_snapshot_generate",
  "Start asynchronous snapshot generation from the saved recipe. Poll or cancel the returned job with the generic QA job tools.",
  {
    bundleId: z.string(),
    cleanup: boolDefault(true),
  },
  async ({ bundleId, cleanup }) =>
    jsonText(
      await qa.post(`/eval/snapshot-bundles/${encode(bundleId)}/generate`, {
        cleanup,
      })
    )
);

server.tool(
  "qa_file_rename",
  "Rename a QA explorer file or folder and remap descendant paths, YAML references, managed snapshot paths, and path-based playlist ids.",
  {
    path: z.string(),
    newName: z.string(),
  },
  async ({ path, newName }) => jsonText(await qa.patch("/eval/files/rename", { path, new_name: newName }))
);

server.tool(
  "qa_file_move",
  "Move a QA explorer file or folder.",
  {
    path: z.string(),
    destination: z.string(),
  },
  async ({ path, destination }) => jsonText(await qa.patch("/eval/files/move", { path, destination }))
);

server.tool(
  "qa_file_delete",
  "Delete a QA explorer file or folder. Inspect references first.",
  {
    path: z.string(),
    recursive: boolDefault(false),
  },
  async ({ path, recursive }) => jsonText(await qa.delete("/eval/files", undefined, { path, recursive }))
);

server.tool(
  "qa_requirements_get",
  "Fetch requirements and computed coverage metadata.",
  {},
  async () => jsonText(await qa.get("/eval/requirements"))
);

server.tool(
  "qa_requirements_yaml_get",
  "Read the raw requirements YAML.",
  {},
  async () => jsonText(await qa.get("/eval/requirements/yaml"))
);

server.tool(
  "qa_requirements_yaml_save",
  "Save the raw requirements YAML with optimistic locking.",
  {
    yaml: z.string(),
    expectedHash: optionalHash,
  },
  async ({ yaml, expectedHash }) =>
    jsonText(
      await qa.put(
        "/eval/requirements/yaml",
        { yaml, expected_hash: expectedHash },
        requirementsWriteQuery
      )
    )
);

server.tool(
  "qa_requirement_create",
  "Create one requirement.",
  {
    requirement: requirementSchema,
    expectedHash: optionalHash,
  },
  async ({ requirement, expectedHash }) =>
    jsonText(
      await qa.post(
        "/eval/requirements",
        { requirement, expected_hash: expectedHash },
        requirementsWriteQuery
      )
    )
);

server.tool(
  "qa_requirement_update",
  "Update one requirement.",
  {
    requirementId: z.string(),
    requirement: requirementSchema,
    expectedHash: optionalHash,
  },
  async ({ requirementId, requirement, expectedHash }) =>
    jsonText(
      await qa.put(
        `/eval/requirements/${encode(requirementId)}`,
        {
          requirement,
          expected_hash: expectedHash,
        },
        requirementsWriteQuery
      )
    )
);

server.tool(
  "qa_requirement_delete",
  "Delete one requirement.",
  {
    requirementId: z.string(),
    expectedHash: optionalHash,
    force: boolDefault(false),
  },
  async ({ requirementId, expectedHash, force }) =>
    jsonText(
      await qa.delete(
        `/eval/requirements/${encode(requirementId)}`,
        {
          expected_hash: expectedHash,
          force,
        },
        requirementsWriteQuery
      )
    )
);

server.tool(
  "qa_requirements_bulk_create",
  "Create multiple requirements.",
  {
    requirements: z.array(requirementSchema),
    expectedHash: optionalHash,
  },
  async ({ requirements, expectedHash }) =>
    jsonText(
      await qa.post(
        "/eval/requirements/bulk",
        { requirements, expected_hash: expectedHash },
        requirementsWriteQuery
      )
    )
);

server.tool(
  "qa_requirements_bulk_delete",
  "Delete multiple requirements.",
  {
    ids: z.array(z.string()),
    expectedHash: optionalHash,
    force: boolDefault(false),
  },
  async ({ ids, expectedHash, force }) =>
    jsonText(
      await qa.post(
        "/eval/requirements/bulk-delete",
        { ids, expected_hash: expectedHash, force },
        requirementsWriteQuery
      )
    )
);

server.tool("qa_coverage_get", "Fetch computed QA coverage.", {}, async () => {
  return jsonText(await qa.get("/eval/coverage"));
});

server.tool("qa_coverage_legacy_get", "Fetch legacy coverage matrix parse.", {}, async () => {
  return jsonText(await qa.get("/eval/coverage/legacy"));
});

server.tool("qa_coverage_migrate_preview_get", "Preview requirements migration data.", {}, async () => {
  return jsonText(await qa.get("/eval/coverage/migrate-preview"));
});

server.tool(
  "qa_runs_list",
  "List saved QA run history.",
  {
    limit: intDefault(50, 1, 500),
    testType: z.string().optional(),
    priority: z.string().optional(),
  },
  async ({ limit, testType, priority }) =>
    jsonText(await qa.get("/eval/runs", { limit, test_type: testType, priority }))
);

server.tool(
  "qa_run_get",
  "Get saved QA run details.",
  { runId: z.string() },
  async ({ runId }) => jsonText(await qa.get(`/eval/runs/${encode(runId)}`))
);

server.tool(
  "qa_run_markdown_get",
  "Get saved QA run markdown report.",
  { runId: z.string() },
  async ({ runId }) => plainText(await qa.text(`/eval/runs/${encode(runId)}/markdown`))
);

server.tool(
  "qa_jobs_list",
  "List active/recent QA runner jobs.",
  { limit: intDefault(20, 1, 200) },
  async ({ limit }) => jsonText(await qa.get("/eval/jobs", { limit }))
);

server.tool("qa_job_get", "Get one QA runner job.", { jobId: z.string() }, async ({ jobId }) => {
  return jsonText(await qa.get(`/eval/jobs/${encode(jobId)}`));
});

server.tool("qa_job_cancel", "Cancel one active QA runner job.", { jobId: z.string() }, async ({ jobId }) => {
  return jsonText(await qa.post(`/eval/jobs/${encode(jobId)}/cancel`, {}));
});

server.tool(
  "qa_test_run",
  "Run one API-runnable catalog test.",
  {
    testId: z.string(),
    ...runOptionsSchema,
  },
  async (args) =>
    jsonText(await qa.post(`/eval/tests/${encode(args.testId)}/run`, snakeRunOptions(args)))
);

server.tool(
  "qa_tests_bulk_run",
  "Queue selected API-runnable tests one by one.",
  {
    testIds: z.array(z.string()).min(1),
    stopOnFailure: boolDefault(false),
    ...runOptionsSchema,
  },
  async (args) =>
    jsonText(
      await qa.post("/eval/tests/bulk-run", {
        test_ids: args.testIds,
        stop_on_failure: args.stopOnFailure,
        ...snakeRunOptions(args),
      })
    )
);

server.tool("qa_profiles_list", "List eval profiles.", {}, async () => {
  return jsonText(await qa.get("/eval/profiles"));
});

server.tool(
  "qa_profile_run",
  "Run an eval profile.",
  {
    profile: z.string(),
    ...suiteRunOptionsSchema,
  },
  async (args) => jsonText(await qa.post(`/eval/profiles/${encode(args.profile)}/run`, snakeSuiteOptions(args)))
);

server.tool(
  "qa_suite_run",
  "Run an eval suite.",
  {
    suite: z.string(),
    ...suiteRunOptionsSchema,
  },
  async (args) => jsonText(await qa.post(`/eval/suites/${encode(args.suite)}/run`, snakeSuiteOptions(args)))
);

server.tool(
  "qa_triage_latest",
  "Fetch latest triage run summaries.",
  { limit: intDefault(20, 1, 200) },
  async ({ limit }) => jsonText(await qa.get("/eval/triage/latest", { limit }))
);

server.tool("qa_baselines_get", "Fetch eval baselines.", {}, async () => {
  return jsonText(await qa.get("/eval/baselines"));
});

server.tool("qa_scenarios_list", "List legacy replay scenarios.", {}, async () => {
  return jsonText(await qa.get("/eval/scenarios"));
});

server.tool(
  "qa_scenario_yaml_get",
  "Read a legacy scenario YAML definition.",
  { scenarioId: z.string() },
  async ({ scenarioId }) => jsonText(await qa.get(`/eval/scenarios/${encode(scenarioId)}/yaml`))
);

server.tool(
  "qa_scenario_yaml_save",
  "Save a legacy scenario YAML definition.",
  {
    scenarioId: z.string(),
    yaml: z.string(),
    expectedHash: optionalHash,
  },
  async ({ scenarioId, yaml, expectedHash }) =>
    jsonText(
      await qa.put(`/eval/scenarios/${encode(scenarioId)}/yaml`, {
        yaml,
        expected_hash: expectedHash,
      })
    )
);

server.tool(
  "qa_scenario_run",
  "Run a legacy replay scenario.",
  {
    scenarioId: z.string(),
    cleanup: boolDefault(true),
    saveLog: boolDefault(true),
    repeat: intDefault(1, 1, 20),
    minPassRate: z.number().min(0).max(1).default(1),
  },
  async (args) =>
    jsonText(
      await qa.post(`/eval/scenarios/${encode(args.scenarioId)}/run`, {
        cleanup: args.cleanup,
        save_log: args.saveLog,
        repeat: args.repeat,
        min_pass_rate: args.minPassRate,
      })
    )
);

server.tool(
  "qa_scenario_runs_list",
  "List saved runs for a legacy scenario.",
  {
    scenarioId: z.string(),
    limit: intDefault(25, 1, 200),
  },
  async ({ scenarioId, limit }) => jsonText(await qa.get(`/eval/scenarios/${encode(scenarioId)}/runs`, { limit }))
);

server.tool(
  "qa_scenario_lifecycle_set",
  "Set lifecycle status for a legacy scenario.",
  {
    scenarioId: z.string(),
    qaStatus: z.enum(["draft", "reviewed", "promoted", "archived"]),
  },
  async ({ scenarioId, qaStatus }) =>
    jsonText(await qa.post(`/eval/scenarios/${encode(scenarioId)}/lifecycle`, { qa_status: qaStatus }))
);

server.tool(
  "qa_legacy_scenario_generate",
  "Use the legacy generator endpoint.",
  {
    description: z.string(),
    autoSave: boolDefault(false),
  },
  async ({ description, autoSave }) =>
    jsonText(await qa.post("/eval/generate-scenario", { description, auto_save: autoSave }))
);

server.tool(
  "qa_legacy_generated_scenario_save",
  "Save legacy generated scenario YAML.",
  {
    yaml: z.string(),
    overwrite: boolDefault(false),
  },
  async ({ yaml, overwrite }) =>
    jsonText(await qa.post("/eval/scenarios/save-generated", { yaml, overwrite }))
);

return server;
}

function requestToken(req: { headers: Record<string, string | string[] | undefined> }): string {
  const authorization = req.headers.authorization;
  const headerValue = Array.isArray(authorization) ? authorization[0] : authorization;
  const [scheme, ...parts] = (headerValue ?? "").split(" ");
  if (scheme?.toLowerCase() === "bearer" && parts.length > 0) {
    return parts.join(" ").trim();
  }

  const mcpToken = req.headers["x-mcp-token"];
  return (Array.isArray(mcpToken) ? mcpToken[0] : mcpToken ?? "").trim();
}

function tokenMatches(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

function requireMcpToken(req: any, res: any, next: () => void) {
  if (!config.mcpToken) {
    logEvent("mcp_auth_error", { reason: "missing_server_token" });
    res.status(500).json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "MCP_TOKEN is required for HTTP transport" },
      id: null,
    });
    return;
  }

  if (!tokenMatches(requestToken(req), config.mcpToken)) {
    logEvent("mcp_auth_error", { reason: "invalid_client_token" });
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
    return;
  }

  next();
}

async function startStdio() {
  logEvent("mcp_start", {
    transport: "stdio",
    qa_runner_url: redactUrl(config.qaRunnerUrl),
  });
  const server = createQaMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp() {
  if (!config.mcpToken) {
    throw new Error("MCP_TOKEN is required when MCP_TRANSPORT=http");
  }

  const app = createMcpExpressApp({
    host: config.httpHost,
    allowedHosts: config.allowedHosts.length > 0 ? config.allowedHosts : undefined,
  });
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  logEvent("mcp_start", {
    transport: "http",
    host: config.httpHost,
    port: config.httpPort,
    allowed_hosts_count: config.allowedHosts.length,
    qa_runner_url: redactUrl(config.qaRunnerUrl),
  });

  app.use((req: any, res: any, next: () => void) => {
    const started = performance.now();
    res.on("finish", () => {
      const sessionId = Array.isArray(req.headers["mcp-session-id"])
        ? req.headers["mcp-session-id"][0]
        : req.headers["mcp-session-id"];
      logEvent("mcp_http_request_end", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Math.round(performance.now() - started),
        session_present: Boolean(sessionId),
      });
    });
    next();
  });

  app.get("/health", (_req: any, res: any) => {
    res.json({
      status: "ok",
      transport: "http",
    });
  });

  app.post("/mcp", requireMcpToken, async (req: any, res: any) => {
    const sessionId = Array.isArray(req.headers["mcp-session-id"])
      ? req.headers["mcp-session-id"][0]
      : req.headers["mcp-session-id"];

    try {
      let transport = sessionId ? transports[sessionId] : undefined;
      if (!transport && !sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport as StreamableHTTPServerTransport;
          },
        });
        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId) delete transports[closedSessionId];
        };
        const server = createQaMcpServer();
        await server.connect(transport);
      }

      if (!transport) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid MCP session" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logEvent("mcp_http_error", {
        method: req.method,
        path: req.path,
        error: errorMessage(error).slice(0, 1000),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", requireMcpToken, async (req: any, res: any) => {
    const sessionId = Array.isArray(req.headers["mcp-session-id"])
      ? req.headers["mcp-session-id"][0]
      : req.headers["mcp-session-id"];
    const transport = sessionId ? transports[sessionId] : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing MCP session ID");
      return;
    }
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", requireMcpToken, async (req: any, res: any) => {
    const sessionId = Array.isArray(req.headers["mcp-session-id"])
      ? req.headers["mcp-session-id"][0]
      : req.headers["mcp-session-id"];
    const transport = sessionId ? transports[sessionId] : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing MCP session ID");
      return;
    }
    await transport.handleRequest(req, res);
  });

  app.listen(config.httpPort, config.httpHost, () => {
    console.error(`SuperAgent QA MCP listening on http://${config.httpHost}:${config.httpPort}/mcp`);
  });
}

if (config.transport === "http") {
  await startHttp();
} else {
  await startStdio();
}
