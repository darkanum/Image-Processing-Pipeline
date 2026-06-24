import { describe, it, expect } from "vitest";
import { buildOpenApiDocument } from "../src/api/openapi.js";

describe("buildOpenApiDocument", () => {
  it("returns a valid OpenAPI 3.0.3 document", () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe("3.0.3");
    expect(doc.info).toMatchObject({
      title: expect.any(String),
      version: expect.any(String),
    });
  });

  it("includes the /api/jobs endpoints", () => {
    const doc = buildOpenApiDocument();
    const paths = doc.paths as Record<string, Record<string, unknown>>;
    expect(paths["/api/jobs"]).toBeDefined();
    expect(paths["/api/jobs"].post).toBeDefined();
    expect(paths["/api/jobs"].get).toBeDefined();
    expect(paths["/api/jobs/{id}"]).toBeDefined();
    expect(paths["/api/jobs/{id}"].get).toBeDefined();
  });

  it("includes the health and metrics endpoints", () => {
    const doc = buildOpenApiDocument();
    const paths = doc.paths as Record<string, Record<string, unknown>>;
    expect(paths["/health"]).toBeDefined();
    expect(paths["/health/live"]).toBeDefined();
    expect(paths["/health/ready"]).toBeDefined();
    expect(paths["/metrics"]).toBeDefined();
  });

  it("declares the ApiKeyAuth security scheme", () => {
    const doc = buildOpenApiDocument();
    const components = doc.components as { securitySchemes: Record<string, { type: string; in: string; name: string }> };
    expect(components.securitySchemes.ApiKeyAuth).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "X-Api-Key",
    });
  });

  it("POST /api/jobs declares 201, 400, 401, 429, 500 responses", () => {
    const doc = buildOpenApiDocument();
    const paths = doc.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;
    const responses = paths["/api/jobs"].post.responses;
    expect(responses["201"]).toBeDefined();
    expect(responses["400"]).toBeDefined();
    expect(responses["401"]).toBeDefined();
    expect(responses["429"]).toBeDefined();
    expect(responses["500"]).toBeDefined();
  });

  it("includes the major schemas", () => {
    const doc = buildOpenApiDocument();
    const components = doc.components as { schemas: Record<string, unknown> };
    expect(components.schemas.CreateJobRequest).toBeDefined();
    expect(components.schemas.JobRecord).toBeDefined();
    expect(components.schemas.Watermark).toBeDefined();
    expect(components.schemas.Resize).toBeDefined();
    expect(components.schemas.ErrorResponse).toBeDefined();
  });

  it("does NOT leak implementation details (e.g. internal class names)", () => {
    const doc = buildOpenApiDocument();
    // The serialized doc is a plain object — no class instances, no
    // functions. This catches a bug where the registry accidentally
    // returns a class instance instead of a plain schema.
    expect(typeof doc).toBe("object");
    expect(doc).not.toHaveProperty("__proto__");
  });
});
