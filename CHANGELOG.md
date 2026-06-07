# Changelog

All notable changes to `@rosalinddb/mcp` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-07

Recall-tier (read-your-writes) support.

### Added
- **Single-vector "memory" tools** for the recall tier's read-your-writes /
  read-your-deletes model:
  - `get_vector` — fetch one record's id + metadata (optionally its stored
    embedding via `include_values`).
  - `list_vectors` — enumerate / audit stored vectors with an optional flat
    metadata filter and cursor paging.
  - `delete_vector` — delete one vector by id. Reports a **synchronous tombstone**
    (`{ synchronous: true }`, read-your-deletes) when the recall tier is on, or
    `{ async: true, job_id }` when it is off (both also carry `deleted` + `id`).
- Error hints for the recall tier: `recall_write_failed`, `recall_delete_failed`,
  and `recall_unavailable` (HTTP 503 — the read-your-writes tier is momentarily
  down; retry).

### Changed
- `ingest_vectors` now documents **read-your-writes**: a synchronous write (no
  `job_id` in the result) is immediately queryable; an async write returns a
  `job_id` to poll via `get_dataset`.
- `query_vectors` now documents the response `mode` (`recall` | `hot` | `cold` |
  `ephemeral`) and the recall ∪ consolidated union semantics.

No breaking changes — existing tools and configuration are unchanged.

## [0.1.0] - 2026-05-22

### Added
- Initial public release. MCP server over the RosalindDB `v1` REST API with eight
  tools (`list_datasets`, `create_dataset`, `get_dataset`, `delete_dataset`,
  `ingest_vectors`, `query_vectors`, `get_usage`, `list_api_keys`), OSS-no-auth
  and `rb_live_` API-key modes, and actionable error mapping.

[0.2.0]: https://github.com/rosalinddb/rosalinddb-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rosalinddb/rosalinddb-mcp/releases/tag/v0.1.0
