import type { QaMcpConfig } from "./config.js";
import { errorMessage, logEvent, redactUrl } from "./logger.js";

type QueryValue = string | number | boolean | undefined;
type JsonBody = Record<string, unknown> | unknown[] | undefined;

export class QaRunnerClient {
  constructor(private readonly config: QaMcpConfig) {}

  async get<T>(path: string, query: Record<string, QueryValue> = {}): Promise<T> {
    return this.request<T>("GET", path, query);
  }

  async post<T>(
    path: string,
    body?: JsonBody,
    query: Record<string, QueryValue> = {}
  ): Promise<T> {
    return this.request<T>("POST", path, query, body);
  }

  async put<T>(
    path: string,
    body?: JsonBody,
    query: Record<string, QueryValue> = {}
  ): Promise<T> {
    return this.request<T>("PUT", path, query, body);
  }

  async patch<T>(
    path: string,
    body?: JsonBody,
    query: Record<string, QueryValue> = {}
  ): Promise<T> {
    return this.request<T>("PATCH", path, query, body);
  }

  async delete<T>(
    path: string,
    body?: JsonBody,
    query: Record<string, QueryValue> = {}
  ): Promise<T> {
    return this.request<T>("DELETE", path, query, body);
  }

  async text(path: string, query: Record<string, QueryValue> = {}): Promise<string> {
    const response = await this.fetch("GET", path, query);
    return response.text();
  }

  private async request<T>(
    method: string,
    path: string,
    query: Record<string, QueryValue> = {},
    body?: JsonBody
  ): Promise<T> {
    const response = await this.fetch(method, path, query, body);
    return (await response.json()) as T;
  }

  private async fetch(
    method: string,
    path: string,
    query: Record<string, QueryValue> = {},
    body?: JsonBody
  ): Promise<Response> {
    const url = new URL(path, this.config.qaRunnerUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.config.qaRunnerToken) {
      headers.Authorization = `Bearer ${this.config.qaRunnerToken}`;
    }

    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      logEvent("qa_runner_request_error", {
        method,
        url: redactUrl(url.toString()),
        duration_ms: Math.round(performance.now() - started),
        error: errorMessage(error).slice(0, 1000),
      });
      throw error;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      logEvent("qa_runner_request_end", {
        method,
        url: redactUrl(url.toString()),
        status: response.status,
        ok: false,
        duration_ms: Math.round(performance.now() - started),
        response_bytes: Buffer.byteLength(errorBody),
      });
      throw new Error(`QA runner ${response.status} ${response.statusText}: ${errorBody}`);
    }

    logEvent("qa_runner_request_end", {
      method,
      url: redactUrl(url.toString()),
      status: response.status,
      ok: true,
      duration_ms: Math.round(performance.now() - started),
      response_bytes: Number(response.headers.get("content-length") || 0) || undefined,
    });

    return response;
  }
}
