import assert from "node:assert/strict";
import { test } from "node:test";
import { referencedTemplateKeys, statusPair } from "../dist/template-promotion.js";

function versionRow(status, version_number, id = `${status}-${version_number}`) {
  return { id, status, version_number };
}

test("promotion selects the exact next draft while preserving historical draft rows", () => {
  const published = versionRow("PUBLISHED", 202);
  const current = versionRow("DRAFT", 203);
  const rows = [versionRow("DRAFT", 195), current, versionRow("DRAFT", 194),
    published, ...[193, 192, 191].map((number) => versionRow("DRAFT", number))];
  const before = structuredClone(rows);
  assert.deepEqual(statusPair(rows, "production"), { PUBLISHED: published, DRAFT: current });
  assert.deepEqual(rows, before);
});

test("promotion accepts the DEV current pair and a stale draft at the published number", () => {
  const published = versionRow("PUBLISHED", 274);
  const current = versionRow("DRAFT", 275);
  assert.deepEqual(statusPair([versionRow("DRAFT", 274), published, current], "DEV"),
    { PUBLISHED: published, DRAFT: current });
});

const invalidPairs = {
  "multiple published versions": [versionRow("PUBLISHED", 201), versionRow("PUBLISHED", 202), versionRow("DRAFT", 203)],
  "missing published version": [versionRow("DRAFT", 203)],
  "missing draft": [versionRow("PUBLISHED", 202)],
  "historical drafts only": [versionRow("PUBLISHED", 202), versionRow("DRAFT", 195)],
  "missing exact next draft": [versionRow("PUBLISHED", 202), versionRow("DRAFT", 204)],
  "a newer competing draft": [versionRow("PUBLISHED", 202), versionRow("DRAFT", 203), versionRow("DRAFT", 204)],
  "duplicate current drafts": [versionRow("PUBLISHED", 202), versionRow("DRAFT", 203, "first"), versionRow("DRAFT", 203, "second")],
  "string version number": [versionRow("PUBLISHED", "202"), versionRow("DRAFT", 203)],
  "fractional historical version": [versionRow("PUBLISHED", 202), versionRow("DRAFT", 203), versionRow("DRAFT", 191.5)],
  "unsafe next version": [versionRow("PUBLISHED", Number.MAX_SAFE_INTEGER), versionRow("DRAFT", Number.MAX_SAFE_INTEGER + 1)],
};
for (const [description, rows] of Object.entries(invalidPairs)) {
  test(`promotion rejects ${description}`, () => {
    assert.throws(() => statusPair(rows, "production"),
      { message: "production must have exactly one current PUBLISHED version and its next DRAFT" });
  });
}

function version(fields) {
  return { pdfme_layout: { schemas: [fields] } };
}

test("promotion discovers dependencies from published and draft without prompt-library scope", () => {
  const template = {
    key: { jurisdiction_code: "AZ", product_family: "LEASE",
      template_type: "CONTRACT", slug: "residential-lease" },
    versions: {
      PUBLISHED: version([{ name: "pet", triggers_addendum: "pet-addendum" }]),
      DRAFT: version([{ name: "utility", addendum_mapping: "utility-addendum.amount" }]),
    },
  };
  assert.deepEqual(referencedTemplateKeys(template).map((item) => item.slug),
    ["pet-addendum", "utility-addendum"]);
  assert.ok(referencedTemplateKeys(template).every((item) => item.template_type === "ADDENDA"));
});

test("listing child references resolve to listing attachments", () => {
  const template = {
    key: { jurisdiction_code: "AZ", product_family: "LISTING",
      template_type: "LISTING_CONTRACT", slug: "listing-contract" },
    versions: {
      PUBLISHED: version([{ triggers_listing_document: "disclosure" }]),
      DRAFT: version([{ reflects_listing_document: "disclosure" }]),
    },
  };
  assert.deepEqual(referencedTemplateKeys(template), [{
    jurisdiction_code: "AZ", product_family: "LISTING",
    template_type: "LISTING_ATTACHMENT", slug: "disclosure",
  }]);
});
