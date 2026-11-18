import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getHealth } from "./api";

function stubFetch(status: number, body: string, statusText = "Error") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status, statusText })),
  );
}

async function failure(): Promise<ApiError> {
  const err = await getHealth().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe("request() error messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the message field of a JSON error body", async () => {
    stubFetch(
      500,
      JSON.stringify({
        statusCode: 500,
        error: "Internal Server Error",
        message: "Simulated failure",
      }),
    );
    const err = await failure();
    expect(err.status).toBe(500);
    expect(err.message).toBe("Simulated failure");
  });

  it("uses the message of a Fastify validation error", async () => {
    stubFetch(
      400,
      JSON.stringify({
        statusCode: 400,
        code: "FST_ERR_VALIDATION",
        error: "Bad Request",
        message: "body must have required property 'name'",
      }),
    );
    const err = await failure();
    expect(err.status).toBe(400);
    expect(err.message).toBe("body must have required property 'name'");
  });

  it("falls back to the raw body for JSON without a string message", async () => {
    const body = JSON.stringify({ statusCode: 502, error: "Bad Gateway" });
    stubFetch(502, body);
    const err = await failure();
    expect(err.status).toBe(502);
    expect(err.message).toBe(body);
  });

  it("falls back to the raw body for plain text", async () => {
    stubFetch(503, "Service Unavailable: upstream down");
    const err = await failure();
    expect(err.status).toBe(503);
    expect(err.message).toBe("Service Unavailable: upstream down");
  });

  it("falls back to the status text for an empty body", async () => {
    stubFetch(404, "", "Not Found");
    const err = await failure();
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not Found");
  });
});
