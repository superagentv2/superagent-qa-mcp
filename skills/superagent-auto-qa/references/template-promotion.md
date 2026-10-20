# Template Configuration Promotion

Use this workflow only when the user explicitly asks to copy or replace a
contract template's configuration between environments. STAGING is production
data. The NewVoice prompt library is developer-owned and outside this feature.
The tool copies template-version prompt fields; those belong to the contract
configuration and are distinct from the prompt library.

1. Use `qa_templates_list` in both environments to identify the exact
   `jurisdiction_code`, `product_family`, `template_type`, and `slug`.
   Pass `slug: null` when the template has no slug.
2. Call `qa_template_promotion_preview` with `source_environment`,
   `target_environment`, and that exact identity. It includes child templates
   referenced by the source published or draft layout. Inspect every entry in
   `changes`, including target draft content that will cease to be current.
3. When the user has authorized this migration, call
   `qa_template_promotion_apply` with the preview's `plan_id`, `source_hash`,
   and `target_hash`. Preview plans expire after 15 minutes. A source or target
   change invalidates the plan; obtain a new preview rather than guessing.
4. Read the receipt. `committed: true` means database replacement committed.
   `cache_refresh: "ok"` means the target backend accepted cache refresh.
   If the database committed but refresh failed, retry the same apply plan or
   use `qa_template_promotion_cache_refresh` for the target environment.
5. Read back the target with `qa_template_version_get` or a fresh preview.
   Runtime cache refresh and database equality are distinct evidence.

The apply tool inserts new PUBLISHED and DRAFT versions with target-generated
IDs and copies active prefill mappings to those versions. It deprecates the
former current versions without deleting or repointing historical documents
and voice sessions. It copies title and creates a missing linked target
template when that active jurisdiction/family/type/slug identity is absent.
Current version numbers advance in
the target; they are not copied from the source.

The bundle contains layout JSON (including embedded base PDF and fields),
template/document prompt, extraction prompt, voice-agent prompt, active
prefill mappings, and child forms referenced by layout fields. It excludes
NewVoice prompt-library revisions, clause catalog, customer documents, calls,
and user data. If a workflow needs those other surfaces, plan them as separate
changes; do not describe this tool as a whole-environment clone.
