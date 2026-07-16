# SuperAgent QA MCP

MCP server that lets Codex interact with SuperAgent QA automation through the
QA Runner API, without direct access to the codebase.

## Development

```bash
npm install
npm run build
npm run dev
```

## Configuration

```env
QA_RUNNER_URL=http://localhost:8090
QA_MCP_TOKEN=
```

`QA_RUNNER_URL` points to the Python QA runner API. `QA_MCP_TOKEN` is reserved
for hosted/authenticated deployments.

## Initial Tools

- `qa_health_get`
- `qa_manifest_get`
- `qa_catalog_search`

The full MCP should grow to mirror the Admin QA API: definitions, files,
snapshots, requirements, lifecycle, linting, runs, jobs, and bulk execution.

