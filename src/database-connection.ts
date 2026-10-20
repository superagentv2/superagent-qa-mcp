import type { PoolConfig } from "pg";

/** Keep database TLS authenticated against the managed cluster's private CA. */
export function databasePoolConfig(connectionString: string, options: PoolConfig = {}): PoolConfig {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get("sslmode");
  if (!sslmode && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
    return { ...options, connectionString };
  }
  if (sslmode !== "require") throw new Error("Database TLS mode must be require");
  const encodedCa = process.env.QA_DATABASE_CA_CERT_B64?.trim();
  const ca = encodedCa ? Buffer.from(encodedCa, "base64").toString("utf8") : "";
  if (!ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
    throw new Error("Database CA certificate is not configured");
  }
  // node-postgres treats sslmode=require as full hostname verification. This
  // managed cluster's certificate uses its internal name, so verify the chain
  // against its pinned project CA instead.
  url.searchParams.delete("sslmode");
  return { ...options, connectionString: url.toString(), ssl: {
    ca, rejectUnauthorized: true, checkServerIdentity: () => undefined,
  } };
}
