import assert from "node:assert/strict";
import { test } from "node:test";
import { databasePoolConfig } from "../dist/database-connection.js";

test("local databases work without a managed CA", () => {
  const url = "postgres://postgres@127.0.0.1:55432/postgres";
  assert.deepEqual(databasePoolConfig(url, { max: 1 }), { connectionString: url, max: 1 });
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
