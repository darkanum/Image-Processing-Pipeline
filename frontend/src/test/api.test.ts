import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError, apiRequest } from "../lib/api";

describe("apiRequest", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on 200", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const res = await apiRequest<{ ok: boolean }>("/jobs", { method: "GET" });
    expect(res.ok).toBe(true);
  });

  it("throws ApiError with status + body on 4xx", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "nope", requestId: "abc" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = mockFetch as unknown as typeof fetch;
    try {
      await apiRequest("/jobs", { method: "POST", body: {} });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(400);
      expect(err.message).toBe("nope");
      expect(err.requestId).toBe("abc");
    }
  });

  it("throws ApiError on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
    try {
      await apiRequest("/jobs");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(0);
      expect((e as ApiError).code).toBe("NETWORK");
    }
  });
});
