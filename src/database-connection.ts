import type { PoolConfig } from "pg";
import { checkServerIdentity } from "node:tls";

/** Keep database TLS authenticated against the managed cluster's private CA. */
export function databasePoolConfig(connectionString: string, options: PoolConfig = {}): PoolConfig {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get("sslmode");
  const verifyFull = process.env.QA_DATABASE_TLS_VERIFY_FULL === "true";
  if (!verifyFull && !sslmode && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
    return { ...options, connectionString };
  }
  if (sslmode !== (verifyFull ? "verify-full" : "require")) {
    throw new Error(`Database TLS mode must be ${verifyFull ? "verify-full" : "require"}`);
  }
  // pg-connection-string can replace a supplied ssl object when URI SSL
  // parameters remain. Reject overrides and remove our validated mode below.
  if (url.searchParams.getAll("sslmode").length !== 1 ||
      [...url.searchParams.keys()].some((key) =>
        (key.toLowerCase().startsWith("ssl") && key !== "sslmode") ||
        key.toLowerCase() === "uselibpqcompat")) {
    throw new Error("Database URL must not override TLS settings");
  }
  const encodedCa = process.env.QA_DATABASE_CA_CERT_B64?.trim();
  const ca = encodedCa ? Buffer.from(encodedCa, "base64").toString("utf8") : "";
  if (!ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
    throw new Error("Database CA certificate is not configured");
  }
  // The legacy managed endpoint needs chain-only verification against its CA.
  // AWS opt-in uses Node's standard SAN/hostname verifier as well as the CA.
  url.searchParams.delete("sslmode");
  return { ...options, connectionString: url.toString(), ssl: {
    ca, rejectUnauthorized: true,
    checkServerIdentity: verifyFull ? checkServerIdentity : () => undefined,
  } };
}
