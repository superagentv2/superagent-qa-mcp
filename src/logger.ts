import { AsyncLocalStorage } from "node:async_hooks";

type LogValue = string | number | boolean | null | undefined;

export type LogFields = Record<string, LogValue>;

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|api[_-]?key|bearer)/i;
const logContext = new AsyncLocalStorage<LogFields>();

export function nowIso(): string {
  return new Date().toISOString();
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    return url.toString();
  } catch {
    return value.replace(/([?&][^=]*(?:token|key|secret|password)[^=]*=)[^&]+/gi, "$1<redacted>");
  }
}

export function logEvent(event: string, fields: LogFields = {}): void {
  const context = logContext.getStore() ?? {};
  const safeFields: LogFields = {};
  for (const [key, value] of Object.entries({ ...context, ...fields })) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      safeFields[key] = "<redacted>";
    } else if (typeof value === "string" && SENSITIVE_KEY_PATTERN.test(value)) {
      safeFields[key] = "<redacted>";
    } else {
      safeFields[key] = value;
    }
  }

  console.error(JSON.stringify({ ts: nowIso(), event, ...safeFields }));
}

export function withLogContext<T>(fields: LogFields, callback: () => T): T {
  return logContext.run({ ...(logContext.getStore() ?? {}), ...fields }, callback);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function responseByteLength(payload: unknown): number {
  if (payload === undefined) return 0;
  if (typeof payload === "string") return Buffer.byteLength(payload);
  try {
    return Buffer.byteLength(JSON.stringify(payload));
  } catch {
    return 0;
  }
}
