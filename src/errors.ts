/**
 * Error handling for the RosalindDB MCP server.
 *
 * RosalindDB's REST API returns a consistent error envelope on any 4xx/5xx:
 *   { "error": { "code": "snake_case_code", "message": "...", "details": { } } }
 *
 * `RosalindApiError` carries the parsed envelope so tool handlers can surface a
 * clear, actionable message to the MCP client instead of a raw stack trace.
 */

export interface RosalindErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class RosalindApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RosalindApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /**
   * A human-readable, LLM-actionable description of the failure. This is what
   * gets returned to the MCP client when a tool call fails.
   */
  toToolMessage(): string {
    const base = `RosalindDB API error (HTTP ${this.status}, ${this.code}): ${this.message}`;
    const hint = ERROR_HINTS[this.code];
    const detailStr =
      this.details && Object.keys(this.details).length > 0
        ? ` Details: ${JSON.stringify(this.details)}.`
        : "";
    return hint ? `${base}.${detailStr} ${hint}` : `${base}.${detailStr}`;
  }
}

/**
 * Actionable hints keyed by the API's snake_case error codes. Keeps the
 * messages an agent sees concrete ("what should I do about it").
 */
export const ERROR_HINTS: Record<string, string> = {
  unauthorized:
    "Check that ROSALINDDB_API_KEY is set to a valid rb_live_ key and has not been revoked.",
  auth_disabled:
    "This deployment runs with RB_REQUIRE_AUTH=false (OSS single-tenant mode). " +
    "API-key and signup endpoints are disabled. To enable per-tenant keys, " +
    "restart the backend with RB_REQUIRE_AUTH=true and a JWT_SECRET set.",
  dataset_not_found:
    "The dataset does not exist for this account. List datasets to see valid names, or create it first.",
  dataset_exists:
    "A dataset with this name already exists. Choose a different name or use the existing one.",
  invalid_name:
    "Dataset names must be 1-64 chars matching [a-z0-9_-]+.",
  invalid_request:
    "The request body is malformed or has an invalid field. A common cause is a " +
    "metadata filter value that is nested or an array; filters only accept flat " +
    "scalar values (string, number, boolean, null) with exact-match semantics.",
  invalid_dimension: "Dimension must be a positive integer.",
  invalid_ndjson: "Each vector record must be a valid JSON object.",
  dimension_mismatch:
    "The query/ingest vector length must equal the dataset's dimension.",
  top_k_out_of_range: "top_k must be between 1 and 1000.",
  vector_quota_exceeded:
    "The account has hit its stored-vector quota. Delete unused datasets or upgrade the plan.",
  query_quota_exceeded:
    "The account has hit its daily query quota. Retry after the reset time.",
  rate_limited: "Per-key rate limit exhausted. Retry after a short backoff.",
  payload_too_large:
    "The ingest body exceeds the 10 MiB cap. Split it into smaller batches.",
  not_found: "The requested resource was not found for this account.",
  recall_write_failed:
    "The recall (read-your-writes) tier rejected the synchronous write, so it was NOT " +
    "committed. Retry the ingest; if it persists, the server's recall pgvector instance " +
    "(RB_RECALL_DSN) may be down.",
  recall_unavailable:
    "The recall (read-your-writes) tier is unavailable, so the query was refused rather " +
    "than silently returning stale consolidated-only results. Retry shortly; if it " +
    "persists, the server's recall instance may be down.",
  recall_delete_failed:
    "The recall (read-your-writes) tier failed to tombstone the vector, so it was NOT " +
    "deleted. Retry; if it persists, the server's recall pgvector instance " +
    "(RB_RECALL_DSN) may be down.",
};

/**
 * Build a RosalindApiError from an HTTP response that failed. Falls back
 * gracefully when the body is not a well-formed error envelope.
 */
export async function errorFromResponse(
  status: number,
  rawBody: string,
): Promise<RosalindApiError> {
  let code = "internal_error";
  let message = rawBody || `HTTP ${status}`;
  let details: Record<string, unknown> | undefined;

  try {
    const parsed = JSON.parse(rawBody) as Partial<RosalindErrorEnvelope>;
    if (parsed && parsed.error && typeof parsed.error === "object") {
      code = parsed.error.code ?? code;
      message = parsed.error.message ?? message;
      details = parsed.error.details;
    }
  } catch {
    // Body was not JSON; keep the raw text as the message.
  }

  return new RosalindApiError(status, code, message, details);
}
