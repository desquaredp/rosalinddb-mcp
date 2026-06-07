import { describe, it, expect } from "vitest";
import {
  TOOLS,
  createDatasetSchema,
  queryVectorsSchema,
  ingestVectorsSchema,
  getVectorSchema,
  listVectorsSchema,
  deleteVectorSchema,
} from "../src/tools.js";
import { RosalindClient } from "../src/client.js";

function fakeFetch(
  status: number,
  body: string,
  capture?: (url: string, init: RequestInit) => void,
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    capture?.(url, init);
    // 204/205/304 must not carry a body per the Response spec (mirrors the
    // helper in client.test.ts) — a real server sends a bodiless 204 here.
    const nullBody = status === 204 || status === 205 || status === 304;
    return new Response(nullBody ? null : body, { status });
  }) as unknown as typeof fetch;
}

describe("tool registry", () => {
  it("registers the full management surface", () => {
    const names = TOOLS.map((t) => t.name).sort();
    const required = [
      "create_dataset",
      "delete_dataset",
      "delete_vector",
      "get_dataset",
      "get_usage",
      "get_vector",
      "ingest_vectors",
      "list_api_keys",
      "list_datasets",
      "list_vectors",
      "query_vectors",
    ].sort();
    // forward-compatible: required tools must all be present, additional
    // tools (e.g. a future import_dataset) are allowed.
    for (const name of required) {
      expect(names).toContain(name);
    }
    expect(TOOLS.length).toBeGreaterThanOrEqual(11);
  });

  it("every tool has a non-trivial description", () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});

describe("createDatasetSchema", () => {
  it("accepts a valid name and dimension", () => {
    const out = createDatasetSchema.parse({ name: "products", dimension: 768 });
    expect(out.name).toBe("products");
  });

  it("rejects names with invalid characters", () => {
    expect(() =>
      createDatasetSchema.parse({ name: "Bad Name", dimension: 8 }),
    ).toThrowError();
  });

  it("rejects a non-positive dimension", () => {
    expect(() =>
      createDatasetSchema.parse({ name: "ok", dimension: 0 }),
    ).toThrowError();
  });
});

describe("queryVectorsSchema", () => {
  it("accepts a flat metadata filter", () => {
    const out = queryVectorsSchema.parse({
      dataset: "products",
      vector: [0.1, 0.2],
      top_k: 5,
      filter: { category: "books", year: 2024 },
    });
    expect(out.filter).toEqual({ category: "books", year: 2024 });
  });

  it("rejects a top_k above the 1000 max", () => {
    expect(() =>
      queryVectorsSchema.parse({ dataset: "d", vector: [1], top_k: 1001 }),
    ).toThrowError();
  });

  it("rejects a nested filter value", () => {
    expect(() =>
      queryVectorsSchema.parse({
        dataset: "d",
        vector: [1],
        filter: { meta: { nested: true } },
      }),
    ).toThrowError();
  });
});

describe("ingestVectorsSchema", () => {
  it("requires at least one record", () => {
    expect(() =>
      ingestVectorsSchema.parse({ dataset: "d", records: [] }),
    ).toThrowError();
  });

  it("accepts records with optional metadata", () => {
    const out = ingestVectorsSchema.parse({
      dataset: "d",
      records: [{ id: "x", values: [1, 2], metadata: { t: "A" } }],
    });
    expect(out.records[0].id).toBe("x");
  });
});

describe("tool handlers hit the right endpoint", () => {
  it("create_dataset POSTs to /v1/datasets", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(201, "{}", (u, init) => {
        seenUrl = u;
        seenInit = init;
      }),
    });
    const tool = TOOLS.find((t) => t.name === "create_dataset")!;
    await tool.handler(client, { name: "products", dimension: 768 });
    expect(seenUrl).toBe("http://x/v1/datasets");
    expect(seenInit?.method).toBe("POST");
  });

  it("query_vectors POSTs to /v1/query and omits absent optionals", async () => {
    let seenInit: RequestInit | undefined;
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(200, "{}", (_u, init) => (seenInit = init)),
    });
    const tool = TOOLS.find((t) => t.name === "query_vectors")!;
    await tool.handler(client, { dataset: "products", vector: [0.1, 0.2] });
    const body = JSON.parse(seenInit?.body as string);
    expect(body).toEqual({ dataset: "products", vector: [0.1, 0.2] });
    expect(body.top_k).toBeUndefined();
  });

  it("ingest_vectors POSTs NDJSON to the vectors endpoint", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(202, "{}", (u, init) => {
        seenUrl = u;
        seenInit = init;
      }),
    });
    const tool = TOOLS.find((t) => t.name === "ingest_vectors")!;
    await tool.handler(client, {
      dataset: "products",
      records: [{ id: "a", values: [1, 2] }],
    });
    expect(seenUrl).toBe("http://x/v1/datasets/products/vectors");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-ndjson");
  });

  it("get_usage GETs /auth/usage", async () => {
    let seenUrl = "";
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(200, "{}", (u) => (seenUrl = u)),
    });
    const tool = TOOLS.find((t) => t.name === "get_usage")!;
    await tool.handler(client, {});
    expect(seenUrl).toBe("http://x/auth/usage");
  });
});

describe("vector CRUD schemas", () => {
  it("getVectorSchema accepts include_values", () => {
    const out = getVectorSchema.parse({ dataset: "mem", id: "m1", include_values: true });
    expect(out.id).toBe("m1");
    expect(out.include_values).toBe(true);
  });

  it("listVectorsSchema accepts a flat filter + limit", () => {
    const out = listVectorsSchema.parse({
      dataset: "mem",
      filter: { user_id: "u1" },
      limit: 50,
    });
    expect(out.filter).toEqual({ user_id: "u1" });
    expect(out.limit).toBe(50);
  });

  it("deleteVectorSchema requires dataset and id", () => {
    expect(() => deleteVectorSchema.parse({ dataset: "mem" })).toThrowError();
  });
});

describe("vector CRUD handlers", () => {
  it("get_vector GETs the single-vector path and appends include_values", async () => {
    let seenUrl = "";
    const client = new RosalindClient({
      baseUrl: "http://x",
      fetchImpl: fakeFetch(200, JSON.stringify({ id: "m1", metadata: {} }), (u) => (seenUrl = u)),
    });
    const tool = TOOLS.find((t) => t.name === "get_vector")!;
    await tool.handler(client, { dataset: "mem", id: "m1", include_values: true });
    expect(seenUrl).toBe("http://x/v1/datasets/mem/vectors/m1?include_values=true");
  });

  it("list_vectors GETs the vectors path with an encoded filter + limit", async () => {
    let seenUrl = "";
    const client = new RosalindClient({
      baseUrl: "http://x",
      fetchImpl: fakeFetch(200, JSON.stringify({ vectors: [] }), (u) => (seenUrl = u)),
    });
    const tool = TOOLS.find((t) => t.name === "list_vectors")!;
    await tool.handler(client, { dataset: "mem", filter: { user_id: "u1" }, limit: 25 });
    expect(seenUrl).toContain("http://x/v1/datasets/mem/vectors?");
    expect(seenUrl).toContain("limit=25");
    expect(seenUrl).toContain(encodeURIComponent(JSON.stringify({ user_id: "u1" })));
  });

  it("delete_vector reports a synchronous tombstone on 204 (read-your-deletes)", async () => {
    const client = new RosalindClient({
      baseUrl: "http://x",
      fetchImpl: fakeFetch(204, ""),
    });
    const tool = TOOLS.find((t) => t.name === "delete_vector")!;
    const res = (await tool.handler(client, { dataset: "mem", id: "m1" })) as Record<
      string,
      unknown
    >;
    expect(res).toEqual({ deleted: true, id: "m1", synchronous: true });
  });

  it("delete_vector surfaces the async job_id on 202 (recall off)", async () => {
    const client = new RosalindClient({
      baseUrl: "http://x",
      fetchImpl: fakeFetch(202, JSON.stringify({ job_id: "job_abc" })),
    });
    const tool = TOOLS.find((t) => t.name === "delete_vector")!;
    const res = (await tool.handler(client, { dataset: "mem", id: "m1" })) as Record<
      string,
      unknown
    >;
    expect(res).toEqual({ deleted: true, id: "m1", async: true, job_id: "job_abc" });
  });

  it("get_vector without include_values hits the bare single-vector path", async () => {
    let seenUrl = "";
    const client = new RosalindClient({
      baseUrl: "http://x",
      fetchImpl: fakeFetch(200, JSON.stringify({ id: "m1", metadata: {} }), (u) => (seenUrl = u)),
    });
    const tool = TOOLS.find((t) => t.name === "get_vector")!;
    await tool.handler(client, { dataset: "mem", id: "m1" });
    expect(seenUrl).toBe("http://x/v1/datasets/mem/vectors/m1");
  });

  it("list_vectors round-trips a cursor", async () => {
    let seenUrl = "";
    const client = new RosalindClient({
      baseUrl: "http://x",
      fetchImpl: fakeFetch(200, JSON.stringify({ vectors: [], next_cursor: null }), (u) => (seenUrl = u)),
    });
    const tool = TOOLS.find((t) => t.name === "list_vectors")!;
    await tool.handler(client, { dataset: "mem", cursor: "c-42" });
    expect(seenUrl).toContain("cursor=c-42");
  });

  it("list_vectors with no params hits the bare vectors path (no query string)", async () => {
    let seenUrl = "";
    const client = new RosalindClient({
      baseUrl: "http://x",
      fetchImpl: fakeFetch(200, JSON.stringify({ vectors: [] }), (u) => (seenUrl = u)),
    });
    const tool = TOOLS.find((t) => t.name === "list_vectors")!;
    await tool.handler(client, { dataset: "mem" });
    expect(seenUrl).toBe("http://x/v1/datasets/mem/vectors");
  });
});
