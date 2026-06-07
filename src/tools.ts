/**
 * MCP tool definitions for RosalindDB.
 *
 * Each tool is a thin wrapper over one RosalindDB v1 REST endpoint. A tool
 * declares: a name, an LLM-actionable description, a zod input schema, and a
 * handler that calls the API client and returns a plain text/JSON result.
 *
 * Tool -> endpoint map:
 *   list_datasets    -> GET    /v1/datasets
 *   create_dataset   -> POST   /v1/datasets
 *   get_dataset      -> GET    /v1/datasets/{name}
 *   delete_dataset   -> DELETE /v1/datasets/{name}
 *   ingest_vectors   -> POST   /v1/datasets/{name}/vectors  (NDJSON)
 *   query_vectors    -> POST   /v1/query
 *   get_vector       -> GET    /v1/datasets/{name}/vectors/{id}
 *   list_vectors     -> GET    /v1/datasets/{name}/vectors
 *   delete_vector    -> DELETE /v1/datasets/{name}/vectors/{id}
 *   get_usage        -> GET    /auth/usage
 *   list_api_keys    -> GET    /auth/keys
 */

import { z } from "zod";
import type { RosalindClient } from "./client.js";

/** A registered MCP tool. */
export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  handler: (client: RosalindClient, args: z.infer<S>) => Promise<unknown>;
}

// --- Input schemas ----------------------------------------------------------

const datasetNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_-]+$/, "must match [a-z0-9_-]+ (1-64 chars)");

export const listDatasetsSchema = z.object({});

export const createDatasetSchema = z.object({
  name: datasetNameSchema.describe(
    "Dataset name, 1-64 chars, lowercase letters/digits/underscore/hyphen, unique per instance.",
  ),
  dimension: z
    .number()
    .int()
    .positive()
    .describe("Vector dimension; every vector ingested must have this length."),
});

export const getDatasetSchema = z.object({
  name: datasetNameSchema.describe("Name of the dataset to fetch."),
});

export const deleteDatasetSchema = z.object({
  name: datasetNameSchema.describe("Name of the dataset to delete."),
});

const vectorRecordSchema = z.object({
  id: z.string().min(1).max(256).describe("Caller-chosen record id, 1-256 chars."),
  values: z
    .array(z.number())
    .min(1)
    .describe("Vector values; length must equal the dataset's dimension."),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe("Optional arbitrary JSON metadata object for the record."),
});

export const ingestVectorsSchema = z.object({
  dataset: datasetNameSchema.describe("Target dataset name."),
  records: z
    .array(vectorRecordSchema)
    .min(1)
    .describe(
      "Vector records to ingest. Sent as NDJSON; keep batches under ~10 MiB.",
    ),
});

export const queryVectorsSchema = z.object({
  dataset: datasetNameSchema.describe("Dataset to search."),
  vector: z
    .array(z.number())
    .min(1)
    .describe("Query vector; length must equal the dataset's dimension."),
  // Intentionally no .default(10): when top_k is omitted we leave it out of the
  // request so the server applies its own default. Do not add a client-side
  // default here.
  top_k: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Number of nearest neighbours to return (1-1000, default 10)."),
  filter: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .describe(
      "Optional flat metadata filter with AND-of-equals semantics. " +
        "Keys map to exact-match values (no ranges, OR, or nesting). " +
        "Strict typing: string matches string, number matches number.",
    ),
});

const vectorIdSchema = z
  .string()
  .min(1)
  .max(256)
  .describe("Vector record id, 1-256 chars.");

export const getVectorSchema = z.object({
  dataset: datasetNameSchema.describe("Dataset containing the vector."),
  id: vectorIdSchema.describe("Id of the vector record to fetch."),
  include_values: z
    .boolean()
    .optional()
    .describe(
      "If true, also return the stored embedding for a recall-resident vector " +
        "(a consolidated/cold-only vector omits it).",
    ),
});

export const listVectorsSchema = z.object({
  dataset: datasetNameSchema.describe("Dataset to list vectors from."),
  filter: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .describe("Optional flat metadata filter (exact-match AND-of-equals)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Max records to return in this page (server applies its own default)."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque pagination cursor returned as next_cursor by a prior call."),
});

export const deleteVectorSchema = z.object({
  dataset: datasetNameSchema.describe("Dataset containing the vector."),
  id: vectorIdSchema.describe("Id of the vector record to delete."),
});

export const getUsageSchema = z.object({});

export const listApiKeysSchema = z.object({});

// --- Tool registry ----------------------------------------------------------

export const TOOLS: ToolDef[] = [
  {
    name: "list_datasets",
    description:
      "List all vector datasets in the RosalindDB instance, with each dataset's " +
      "dimension, status, and row count.",
    schema: listDatasetsSchema,
    handler: (client) => client.get("/v1/datasets"),
  },
  {
    name: "create_dataset",
    description:
      "Create a new empty vector dataset. You choose the name and the vector " +
      "dimension; vectors are added afterwards with ingest_vectors.",
    schema: createDatasetSchema,
    handler: (client, args) =>
      client.postJson("/v1/datasets", {
        name: args.name,
        dimension: args.dimension,
      }),
  },
  {
    name: "get_dataset",
    description:
      "Get a single dataset's details: dimension, status (empty/validating/" +
      "indexing/indexed/error), row count, and timestamps. Useful for polling " +
      "indexing progress after ingest.",
    schema: getDatasetSchema,
    handler: (client, args) =>
      client.get(`/v1/datasets/${encodeURIComponent(args.name)}`),
  },
  {
    name: "delete_dataset",
    description:
      "Delete a dataset and all its vectors. This is a soft-delete; the dataset " +
      "becomes immediately unavailable.",
    schema: deleteDatasetSchema,
    handler: async (client, args) => {
      await client.delete(`/v1/datasets/${encodeURIComponent(args.name)}`);
      return { deleted: true, name: args.name };
    },
  },
  {
    name: "ingest_vectors",
    description:
      "Ingest (upsert) vector records into a dataset (last-write-wins per id). Each " +
      "record needs an id, a values array matching the dataset dimension, and optional " +
      "flat metadata. The response reports accepted/rejected counts and per-record " +
      "errors. Read-your-writes depends on the server's recall tier: if the result has " +
      "NO job_id the write was synchronous and is immediately queryable; if it returns " +
      "a job_id, indexing is asynchronous (eventually consistent) — poll get_dataset " +
      "until status is 'indexed'. For dumps over ~10 MiB use the async import flow.",
    schema: ingestVectorsSchema,
    handler: (client, args) =>
      client.postNdjson(
        `/v1/datasets/${encodeURIComponent(args.dataset)}/vectors`,
        args.records as Record<string, unknown>[],
      ),
  },
  {
    name: "query_vectors",
    description:
      "Run a vector similarity search against a dataset. Returns nearest neighbours " +
      "sorted by L2 distance (lower score = closer; 0.0 is exact). The result 'mode' " +
      "names the tier that answered: 'recall' = the read-your-writes recall tier; " +
      "'hot'/'cold' = the consolidated object-storage tier ('hot' = shard already " +
      "cached in memory, 'cold' = first fetch from object storage); 'ephemeral' = no " +
      "shard yet (computed on demand). With the recall tier on, a just-ingested vector " +
      "is immediately searchable (read-your-writes). Supports an optional flat metadata " +
      "filter (exact-match AND semantics; run exhaustively server-side).",
    schema: queryVectorsSchema,
    handler: (client, args) => {
      const body: Record<string, unknown> = {
        dataset: args.dataset,
        vector: args.vector,
      };
      if (args.top_k !== undefined) body.top_k = args.top_k;
      if (args.filter !== undefined) body.filter = args.filter;
      return client.postJson("/v1/query", body);
    },
  },
  {
    name: "get_vector",
    description:
      "Fetch a single vector record by id: its id and metadata. Set include_values=" +
      "true to also return the stored embedding for a recall-resident vector (a " +
      "consolidated/cold-only vector omits it even when requested — its absence is " +
      "expected, not an error). Errors with not_found if the id is absent or deleted.",
    schema: getVectorSchema,
    handler: (client, args) => {
      const base = `/v1/datasets/${encodeURIComponent(args.dataset)}/vectors/${encodeURIComponent(
        args.id,
      )}`;
      return client.get(base + (args.include_values ? "?include_values=true" : ""));
    },
  },
  {
    name: "list_vectors",
    description:
      "List vector records (id + metadata) in a dataset, optionally filtered by a flat " +
      "exact-match metadata filter, with a page limit and cursor. Returns { vectors, " +
      "next_cursor }. Useful for enumerating or auditing the memories an agent has stored.",
    schema: listVectorsSchema,
    handler: (client, args) => {
      const params = new URLSearchParams();
      if (args.filter !== undefined) params.set("filter", JSON.stringify(args.filter));
      if (args.limit !== undefined) params.set("limit", String(args.limit));
      if (args.cursor !== undefined) params.set("cursor", args.cursor);
      const qs = params.toString();
      return client.get(
        `/v1/datasets/${encodeURIComponent(args.dataset)}/vectors${qs ? `?${qs}` : ""}`,
      );
    },
  },
  {
    name: "delete_vector",
    description:
      "Delete a single vector (memory) by id. With the recall tier on this is a " +
      "synchronous tombstone — the vector is immediately gone from queries " +
      "(read-your-deletes); otherwise it queues an async rebuild and returns a job_id. " +
      "Deleting an unknown id is a clean no-op; a recall-tier failure surfaces as a " +
      "retryable 503 (recall_delete_failed).",
    schema: deleteVectorSchema,
    handler: async (client, args) => {
      const body = await client.deleteJson<{ job_id?: string } | undefined>(
        `/v1/datasets/${encodeURIComponent(args.dataset)}/vectors/${encodeURIComponent(args.id)}`,
      );
      return body && body.job_id
        ? { deleted: true, id: args.id, async: true, job_id: body.job_id }
        : { deleted: true, id: args.id, synchronous: true };
    },
  },
  {
    name: "get_usage",
    description:
      "Get the instance's current usage and quotas: vectors stored vs quota, " +
      "queries today vs daily quota, and the quota reset time.",
    schema: getUsageSchema,
    handler: (client) => client.get("/auth/usage"),
  },
  {
    name: "list_api_keys",
    description:
      "List the instance's API keys (metadata only; raw key values are never " +
      "returned). Shows each key's name, creation time, last use, and whether " +
      "it has been revoked.",
    schema: listApiKeysSchema,
    handler: (client) => client.get("/auth/keys"),
  },
];
