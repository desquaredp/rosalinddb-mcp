import { describe, it, expect } from "vitest";
import { errorFromResponse, RosalindApiError } from "../src/errors.js";

describe("errorFromResponse", () => {
  it("parses a well-formed RosalindDB error envelope", async () => {
    const body = JSON.stringify({
      error: {
        code: "dataset_not_found",
        message: "no such dataset",
        details: { name: "products" },
      },
    });
    const err = await errorFromResponse(404, body);
    expect(err).toBeInstanceOf(RosalindApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("dataset_not_found");
    expect(err.message).toBe("no such dataset");
    expect(err.details).toEqual({ name: "products" });
  });

  it("falls back gracefully on a non-JSON body", async () => {
    const err = await errorFromResponse(502, "<html>bad gateway</html>");
    expect(err.status).toBe(502);
    expect(err.code).toBe("internal_error");
    expect(err.message).toContain("bad gateway");
  });

  it("falls back when JSON lacks an error envelope", async () => {
    const err = await errorFromResponse(500, JSON.stringify({ oops: true }));
    expect(err.code).toBe("internal_error");
  });
});

describe("RosalindApiError.toToolMessage", () => {
  it("includes an actionable hint for known codes", () => {
    const err = new RosalindApiError(
      429,
      "vector_quota_exceeded",
      "quota hit",
      { limit: 100000, used: 100000 },
    );
    const msg = err.toToolMessage();
    expect(msg).toContain("HTTP 429");
    expect(msg).toContain("vector_quota_exceeded");
    expect(msg).toContain("stored-vector quota");
    expect(msg).toContain('"limit":100000');
  });

  it("maps a 404 dataset_not_found to a clear message", () => {
    const err = new RosalindApiError(404, "dataset_not_found", "missing");
    const msg = err.toToolMessage();
    expect(msg).toContain("does not exist");
  });

  it("handles an unknown code without a hint", () => {
    const err = new RosalindApiError(400, "some_new_code", "weird");
    const msg = err.toToolMessage();
    expect(msg).toContain("some_new_code");
    expect(msg).toContain("weird");
  });

  it("explains auth_disabled (OSS single-tenant backend mode)", () => {
    const err = new RosalindApiError(
      404,
      "auth_disabled",
      "auth endpoints disabled",
    );
    const msg = err.toToolMessage();
    expect(msg).toContain("auth_disabled");
    expect(msg).toContain("RB_REQUIRE_AUTH=false");
    expect(msg).toContain("RB_REQUIRE_AUTH=true");
  });

  it("gives a retry hint for the recall-tier 503 codes", () => {
    for (const code of [
      "recall_write_failed",
      "recall_unavailable",
      "recall_delete_failed",
    ]) {
      const msg = new RosalindApiError(503, code, "tier down").toToolMessage();
      expect(msg).toContain(code);
      expect(msg).toContain("recall");
      expect(msg.toLowerCase()).toContain("retry");
    }
  });
});
