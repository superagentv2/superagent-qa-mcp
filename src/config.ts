import "dotenv/config";

export type QaMcpConfig = {
  qaRunnerUrl: string;
  token: string;
};

export function loadConfig(): QaMcpConfig {
  return {
    qaRunnerUrl: process.env.QA_RUNNER_URL ?? "http://localhost:8090",
    token: process.env.QA_MCP_TOKEN ?? "",
  };
}

