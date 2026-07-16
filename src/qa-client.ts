import type { QaMcpConfig } from "./config.js";

type QueryValue = string | number | boolean | undefined;

export class QaRunnerClient {
  constructor(private readonly config: QaMcpConfig) {}

  async get<T>(path: string, query: Record<string, QueryValue> = {}): Promise<T> {
    const url = new URL(path, this.config.qaRunnerUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`QA runner ${response.status} ${response.statusText}: ${body}`);
    }

    return (await response.json()) as T;
  }
}

