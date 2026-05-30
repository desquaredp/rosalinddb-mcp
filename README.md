<div align="center">

<img src="logo.png" alt="RosalindDB logo" width="160" height="160">

# @rosalinddb/mcp

**Model Context Protocol server for RosalindDB.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![npm](https://img.shields.io/npm/v/@rosalinddb/mcp.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/@rosalinddb/mcp)
[![Node 18+](https://img.shields.io/badge/node-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)

</div>

---

A Model Context Protocol (MCP) server for RosalindDB — a cost-optimized,
object-storage-first vector search database.

This server lets MCP-capable AI clients (Claude Desktop, Cursor, Claude Code,
and others) operate a RosalindDB instance directly: create datasets, ingest
vectors, run similarity queries, and check usage — without hand-writing REST
calls. It is a thin wrapper over RosalindDB's `v1` REST API: it authenticates
with an `rb_live_` API key when the backend has auth enabled, otherwise it
runs unauthenticated against an OSS-default backend. It contains no business
logic of its own.

The RosalindDB engine lives at
[rosalinddb/rosalinddb](https://github.com/rosalinddb/rosalinddb).
Self-host it via `docker compose` and point this MCP at it.

## Tools

| Tool             | RosalindDB endpoint                          | What it does |
|------------------|----------------------------------------------|--------------|
| `list_datasets`  | `GET /v1/datasets`                           | List all datasets with dimension, status, row count. |
| `create_dataset` | `POST /v1/datasets`                          | Create a new empty dataset with a name and vector dimension. |
| `get_dataset`    | `GET /v1/datasets/{name}`                    | Get one dataset's details and indexing status. |
| `delete_dataset` | `DELETE /v1/datasets/{name}`                 | Delete a dataset and its vectors. |
| `ingest_vectors` | `POST /v1/datasets/{name}/vectors` (NDJSON)  | Upsert vector records (id, values, optional metadata). |
| `query_vectors`  | `POST /v1/query`                             | Vector similarity search with an optional flat metadata filter. |
| `get_usage`      | `GET /auth/usage`                            | Current usage and quotas (vectors stored, queries today). |
| `list_api_keys`  | `GET /auth/keys`                             | List the instance's API keys (metadata only). |

For very large embedding dumps (over the 10 MiB `ingest_vectors` cap), use
RosalindDB's async import-job flow directly via the REST API.

## Auth modes

The RosalindDB backend ships in two modes; the MCP server supports both:

- **OSS default** (`RB_REQUIRE_AUTH=false`): no auth, no API key needed. This
  is what `docker compose up` gives you out of the box. Set
  `ROSALINDDB_API_URL` to your stack and leave `ROSALINDDB_API_KEY` unset.
  The `list_api_keys`, `get_usage`, and signup endpoints are disabled in this
  mode; calls to them surface a clear `auth_disabled` hint.
- **Multi-tenant self-host** (`RB_REQUIRE_AUTH=true`): set
  `ROSALINDDB_API_KEY=rb_live_...`. Create a key with `POST /auth/keys` (or
  use `POST /auth/signup` for the first user on a fresh stack).

## Configuration

The server reads two environment variables:

| Variable             | Required | Default                  | Description |
|----------------------|----------|--------------------------|-------------|
| `ROSALINDDB_API_KEY` | No       | —                        | A RosalindDB API key (`rb_live_...`). Required when the backend runs with `RB_REQUIRE_AUTH=true`; omit for an OSS-default backend. |
| `ROSALINDDB_API_URL` | No       | `http://localhost:8080`  | Base URL of the RosalindDB API. |

When set, the key is sent as `Authorization: Bearer rb_live_...` on every
request. A key that doesn't start with `rb_live_` triggers a startup warning
but is not rejected (in case you front the backend with a custom auth proxy).

## Wiring it into an MCP client

Add this to your MCP client config (for Claude Desktop,
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rosalinddb": {
      "command": "npx",
      "args": ["-y", "@rosalinddb/mcp"],
      "env": {
        "ROSALINDDB_API_URL": "http://localhost:8080"
      }
    }
  }
}
```

`npx -y @rosalinddb/mcp` downloads and runs the server on demand — no global
install needed. The server speaks the stdio transport, the standard for a
locally-launched MCP server.

> **Pointing at a non-local instance?** Set `ROSALINDDB_API_URL` to its base
> URL. If auth is on, also set `ROSALINDDB_API_KEY=rb_live_...`. The backend
> lives at
> [rosalinddb/rosalinddb](https://github.com/rosalinddb/rosalinddb).

## Local development

```bash
npm install        # install dependencies
npm run build      # compile TypeScript to dist/
npm test           # run the vitest unit + in-process MCP suite
npm run smoke      # build, then drive a real tools/list over stdio
```

To run the server directly from a local checkout:

```json
{
  "mcpServers": {
    "rosalinddb": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "ROSALINDDB_API_URL": "http://localhost:8080"
      }
    }
  }
}
```

### Live smoke test

With a running RosalindDB stack and a real key, `tests/live-smoke.mjs`
exercises create → ingest → usage → query → delete end to end:

```bash
npm run build
ROSALINDDB_API_KEY=rb_live_... node tests/live-smoke.mjs
```

It is skipped automatically when no key is set.

## Error handling

RosalindDB API errors are mapped to clear, actionable MCP tool errors — never
a raw stack trace. A 404 surfaces as "dataset does not exist — list datasets
or create it first"; a 429 quota error explains the limit and how to recover;
a 404 `auth_disabled` (calling `list_api_keys` against an OSS-default
backend) explains that the auth endpoints are gated behind
`RB_REQUIRE_AUTH=true`.

## License

Apache 2.0. See [LICENSE](./LICENSE).

## Security

To report a vulnerability, see [SECURITY.md](./SECURITY.md).
