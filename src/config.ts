import "dotenv/config";

export type QaMcpConfig = {
  qaRunnerUrl: string;
  mcpToken: string;
  transport: "stdio" | "http";
  httpHost: string;
  httpPort: number;
  allowedHosts: string[];
  qaRunnerToken: string;
};

function parseTransport(value: string | undefined): "stdio" | "http" {
  return value === "http" ? "http" : "stdio";
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "3009");
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 3009;
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(): QaMcpConfig {
  return {
    qaRunnerUrl: process.env.QA_RUNNER_URL ?? "http://localhost:8090",
    mcpToken: process.env.MCP_TOKEN?.trim() || process.env.QA_MCP_TOKEN?.trim() || "",
    transport: parseTransport(process.env.MCP_TRANSPORT),
    httpHost: process.env.MCP_HOST?.trim() || "127.0.0.1",
    httpPort: parsePort(process.env.MCP_PORT),
    allowedHosts: parseList(process.env.MCP_ALLOWED_HOSTS),
    qaRunnerToken: process.env.QA_RUNNER_TOKEN?.trim() ?? "",
  };
}
