/**
 * Thin internal HTTP client for the RosalindDB v1 REST API.
 *
 * Responsibilities only: attach the `Authorization: Bearer rb_live_...` header
 * (when an API key is configured), set a stable User-Agent, resolve the base
 * URL, send/parse JSON (and NDJSON for vector ingest), and map failing
 * responses onto `RosalindApiError`. No business logic.
 */

import { errorFromResponse, RosalindApiError } from "./errors.js";
import { PACKAGE_VERSION } from "./version.js";

/** User-Agent sent on every outgoing request. Pinned to the package version. */
export const USER_AGENT = `@rosalinddb/mcp/${PACKAGE_VERSION}`;

export interface RosalindClientConfig {
  /** rb_live_ API key, or undefined for an OSS-default backend with RB_REQUIRE_AUTH=false. */
  apiKey?: string;
  /** Base URL of the RosalindDB API, e.g. http://localhost:8080 */
  baseUrl: string;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

type Json = Record<string, unknown>;

export class RosalindClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: RosalindClientConfig) {
    this.apiKey = config.apiKey?.trim() || undefined;
    // Drop any trailing slash so path joins are predictable.
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /**
   * Headers attached to every outgoing request. The Authorization header is
   * only set when an API key is configured: in OSS-default backend mode
   * (RB_REQUIRE_AUTH=false) the backend ignores the header anyway, and
   * omitting it keeps wire traffic clean.
   */
  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /** Parse a response body; throw a mapped RosalindApiError on failure. */
  private async handle<T>(res: Response): Promise<T> {
    if (res.ok) {
      if (res.status === 204) {
        return undefined as T;
      }
      const text = await res.text();
      if (!text) {
        return undefined as T;
      }
      return JSON.parse(text) as T;
    }
    const raw = await res.text();
    throw await errorFromResponse(res.status, raw);
  }

  /** GET a JSON endpoint. */
  async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: { ...this.baseHeaders(), Accept: "application/json" },
    });
    return this.handle<T>(res);
  }

  /** POST a JSON body to an endpoint. */
  async postJson<T>(path: string, body: Json): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...this.baseHeaders(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    return this.handle<T>(res);
  }

  /**
   * POST an NDJSON body (one JSON object per line) to an endpoint. Used by the
   * vector-ingest endpoint, which expects application/x-ndjson.
   */
  async postNdjson<T>(path: string, records: Json[]): Promise<T> {
    // Emit a terminal newline: the conventional, safer NDJSON framing so a
    // streaming parser sees each record (including the last) as complete.
    const body = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...this.baseHeaders(),
        "Content-Type": "application/x-ndjson",
        Accept: "application/json",
      },
      body,
    });
    return this.handle<T>(res);
  }

  /** DELETE an endpoint (expects 204). */
  async delete(path: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: { ...this.baseHeaders() },
    });
    await this.handle<void>(res);
  }

  /**
   * DELETE an endpoint and return its parsed body (if any). Unlike `delete`,
   * this surfaces the response so a caller can tell read-your-deletes apart from
   * an async rebuild: a recall-on backend answers a single-vector delete with
   * 204 (synchronous tombstone -> undefined), while a recall-off backend answers
   * 202 with a `{ job_id }` body.
   */
  async deleteJson<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: { ...this.baseHeaders(), Accept: "application/json" },
    });
    return this.handle<T>(res);
  }
}

export { RosalindApiError };
