import assert from "node:assert/strict";
import { test } from "node:test";
import { databasePoolConfig } from "../dist/database-connection.js";

// Tests deliberately choose the mode; inherited deployment env cannot change it.
delete process.env.QA_DATABASE_TLS_VERIFY_FULL;

test("local databases work without a managed CA", () => {
  const url = "postgres://postgres@127.0.0.1:55432/postgres";
  assert.deepEqual(databasePoolConfig(url, { max: 1 }), { connectionString: url, max: 1 });
});

test("AWS opt-in validates hostname and pins CA without URI SSL overrides", () => {
  const priorCa = process.env.QA_DATABASE_CA_CERT_B64;
  const priorFull = process.env.QA_DATABASE_TLS_VERIFY_FULL;
  try {
    process.env.QA_DATABASE_TLS_VERIFY_FULL = "true";
    process.env.QA_DATABASE_CA_CERT_B64 = Buffer.from(
      "-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----\n").toString("base64");
    const url = "postgresql://reader:password@rds.example:5432/superagent_dev?sslmode=verify-full&application_name=qa";
    const config = databasePoolConfig(url, { max: 1, ssl: { rejectUnauthorized: false } });
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.match(config.ssl.ca, /BEGIN CERTIFICATE/);
    assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);
    assert.equal(new URL(config.connectionString).searchParams.get("application_name"), "qa");
    const certificate = { subjectaltname: "DNS:rds.example", subject: { CN: "rds.example" } };
    assert.equal(config.ssl.checkServerIdentity("rds.example", certificate), undefined);
    assert.equal(config.ssl.checkServerIdentity("other.example", certificate)?.code,
      "ERR_TLS_CERT_ALTNAME_INVALID");
    assert.throws(() => databasePoolConfig(url.replace("verify-full", "require")), /mode must be verify-full/);
    assert.throws(() => databasePoolConfig("postgres://reader@127.0.0.1/test"), /mode must be verify-full/);
    for (const suffix of ["sslmode=disable", "sslcert=other", "sslkey=other", "sslrootcert=other",
      "ssl=false", "uselibpqcompat=true"]) {
      assert.throws(() => databasePoolConfig(`${url}&${suffix}`), /must not override TLS/);
    }
  } finally {
    if (priorCa === undefined) delete process.env.QA_DATABASE_CA_CERT_B64;
    else process.env.QA_DATABASE_CA_CERT_B64 = priorCa;
    if (priorFull === undefined) delete process.env.QA_DATABASE_TLS_VERIFY_FULL;
    else process.env.QA_DATABASE_TLS_VERIFY_FULL = priorFull;
  }
});

test("remote databases require and pin a CA without exposing it in the URL", () => {
  const prior = process.env.QA_DATABASE_CA_CERT_B64;
  const url = "postgresql://reader:password@db.example:25060/defaultdb?sslmode=require";
  try {
    delete process.env.QA_DATABASE_CA_CERT_B64;
    assert.throws(() => databasePoolConfig(url), /CA certificate is not configured/);
    process.env.QA_DATABASE_CA_CERT_B64 = Buffer.from(
      "-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----\n").toString("base64");
    const config = databasePoolConfig(url, { max: 2 });
    assert.equal(config.max, 2);
    assert.equal(config.connectionString, "postgresql://reader:password@db.example:25060/defaultdb");
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.match(config.ssl.ca, /BEGIN CERTIFICATE/);
    assert.equal(config.ssl.checkServerIdentity("db.example", {}), undefined);
  } finally {
    if (prior === undefined) delete process.env.QA_DATABASE_CA_CERT_B64;
    else process.env.QA_DATABASE_CA_CERT_B64 = prior;
  }
});
