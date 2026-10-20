import assert from "node:assert/strict";
import { test } from "node:test";
import { referencedTemplateKeys } from "../dist/template-promotion.js";

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
