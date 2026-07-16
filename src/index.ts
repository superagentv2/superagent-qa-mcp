#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { QaRunnerClient } from "./qa-client.js";

const config = loadConfig();
const qa = new QaRunnerClient(config);

const server = new McpServer({
  name: "superagent-qa-mcp",
  version: "0.1.0",
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

server.tool("qa_health_get", "Check whether the QA runner API is reachable.", {}, async () => {
  return jsonText(await qa.get("/health"));
});

server.tool(
  "qa_manifest_get",
  "Fetch the QA manifest used for generation and validation.",
  {
    jurisdictionCode: z.string().default("AZ"),
  },
  async ({ jurisdictionCode }) => {
    return jsonText(await qa.get("/eval/manifest", { jurisdictionCode }));
  }
);

server.tool(
  "qa_catalog_search",
  "Search normalized QA catalog rows.",
  {
    q: z.string().optional(),
    testType: z.string().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    perPage: z.number().int().min(1).max(200).default(25),
  },
  async ({ q, testType, status, priority, perPage }) => {
    return jsonText(
      await qa.get("/eval/tests", {
        q,
        test_type: testType,
        status,
        priority,
        per_page: perPage,
      })
    );
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

