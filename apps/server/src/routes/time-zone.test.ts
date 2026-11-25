import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { TimeZoneService, type TimeZoneRepository } from "@clock-compass/core";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { authPlugin, OWNER_ONLY } from "../plugins/auth.js";
import { callerClock } from "../time-zone.js";
import { timeZoneRoutes } from "./time-zone.js";

/**
 * The zone the app reports (#136): PUT /settings/time-zone sets it, a header
 * never does; TZ, when set, wins. No database: the zone is kept in memory.
 */
class MemoryZone implements TimeZoneRepository {
  zone: string | null = null;
  writes = 0;
  async reported() {
    return this.zone;
  }
  async setReported(zone: string) {
    this.zone = zone;
    this.writes++;
  }
}

const owner = { authorization: "Bearer test-token" };

describe("PUT /settings/time-zone (#136)", () => {
  let app: FastifyInstance;
  let zone: MemoryZone;
  const previousTz = process.env.TZ;

  beforeEach(async () => {
    delete process.env.TZ;
    zone = new MemoryZone();
    app = Fastify();
    await app.register(authPlugin, { token: "test-token", apiKeys: { verify: async (k: string) => k === "generated-key" } as never });
    const service = new TimeZoneService(zone);
    await service.load();
    app.decorate("zones", service);
    await timeZoneRoutes(app, { service });
    app.get("/clock", async (req) => callerClock(req));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  const put = (timeZone: string, headers: Record<string, string> = owner) =>
    app.inject({ method: "PUT", url: "/settings/time-zone", headers, payload: { timeZone } });

  it("before the app reports: UTC", async () => {
    const res = await app.inject({ method: "GET", url: "/settings/time-zone", headers: owner });
    expect(res.json()).toEqual({ zone: "UTC", source: "default", reported: null });
    expect((await app.inject({ method: "GET", url: "/clock" })).json()).toEqual({ timeZone: "UTC" });
  });

  it("a report sets the zone for callers without one; a device still means its own", async () => {
    const res = await put("Europe/Brussels");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ zone: "Europe/Brussels", source: "app", reported: "Europe/Brussels" });
    expect((await app.inject({ method: "GET", url: "/clock" })).json()).toEqual({ timeZone: "Europe/Brussels" });
    expect((await app.inject({ method: "GET", url: "/clock", headers: { "x-time-zone": "America/New_York" } })).json()).toEqual({
      timeZone: "America/New_York",
    });
  });

  it("writes only a change", async () => {
    await put("Europe/Brussels");
    await put("Europe/Brussels");
    expect(zone.writes).toBe(1);
    await put("America/New_York");
    expect(zone.writes).toBe(2);
  });

  it("a request header never sets it", async () => {
    await app.inject({ method: "GET", url: "/settings/time-zone", headers: { ...owner, "x-time-zone": "Europe/Brussels" } });
    await app.inject({ method: "GET", url: "/clock", headers: { "x-time-zone": "Europe/Brussels" } });
    expect(zone.zone).toBeNull();
  });

  it("TZ, when set, wins over the reported zone; an empty TZ counts as not set", async () => {
    await put("Europe/Brussels");
    process.env.TZ = "America/New_York";
    expect((await app.inject({ method: "GET", url: "/clock" })).json()).toEqual({ timeZone: "America/New_York" });
    expect((await app.inject({ method: "GET", url: "/settings/time-zone", headers: owner })).json()).toEqual({
      zone: "America/New_York",
      source: "TZ",
      reported: "Europe/Brussels",
    });
    process.env.TZ = "";
    expect((await app.inject({ method: "GET", url: "/clock" })).json()).toEqual({ timeZone: "Europe/Brussels" });
  });

  it("a generated key may not set it (403); an unknown zone is refused (400)", async () => {
    const generated = await put("Europe/Brussels", { authorization: "Bearer generated-key" });
    expect(generated.statusCode).toBe(403);
    expect(generated.json()).toEqual({ error: OWNER_ONLY });
    expect(zone.zone).toBeNull();
    expect((await put("Mars/Olympus")).statusCode).toBe(400);
    expect((await put("Europe/Brussels", {})).statusCode).toBe(401);
  });
});

describe("scheduled days over the task routes (#136, #137)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: { ...loadConfig(), authToken: "test-token", isProduction: false },
      timeZones: new TimeZoneService(new MemoryZone()),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("takes only a plain date: a date-time (an older app's local midnight) is refused at the door", async () => {
    for (const scheduledDay of ["2026-11-25T23:00:00.000Z", "Thursday"]) {
      const created = await app.inject({ method: "POST", url: "/api/tasks", headers: owner, payload: { title: "x", scheduledDay } });
      expect(created.statusCode, scheduledDay).toBe(400);
      const patched = await app.inject({ method: "PATCH", url: "/api/tasks/t1", headers: owner, payload: { scheduledDay } });
      expect(patched.statusCode, scheduledDay).toBe(400);
    }
  });
});
