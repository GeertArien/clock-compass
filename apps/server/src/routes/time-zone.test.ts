import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { TimeZoneService, type DayMigrationPlan, type DayRepository, type StoredDays, type TimeZoneRepository } from "@clock-compass/core";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { authPlugin, OWNER_ONLY } from "../plugins/auth.js";
import { callerClock } from "../time-zone.js";
import { scheduledDayInput } from "./tasks.js";
import { timeZoneRoutes } from "./time-zone.js";

/**
 * The zone the app reports (#136): PUT /settings/time-zone sets it, a header
 * never does; TZ, when set, wins; the first report moves old scheduled days.
 * No database: the zone and the stored days are in memory.
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

class MemoryDays implements DayRepository {
  applied: DayMigrationPlan[] = [];
  constructor(public days: StoredDays) {}
  async findAll() {
    return this.days;
  }
  async apply(plan: DayMigrationPlan) {
    this.applied.push(plan);
    const moved = new Map(plan.scheduled.map((m) => [m.id, m.to]));
    this.days = { ...this.days, scheduled: (this.days.scheduled ?? []).map((t) => ({ ...t, scheduledDay: moved.get(t.id) ?? t.scheduledDay })) };
  }
}

const owner = { authorization: "Bearer test-token" };
const quiet = { info: () => undefined, warn: () => undefined };
/** Thursday 26 November as a Brussels phone stored it before #136. */
const OLD_BRUSSELS = new Date("2026-11-25T23:00:00.000Z");

describe("PUT /settings/time-zone (#136)", () => {
  let app: FastifyInstance;
  let zone: MemoryZone;
  let days: MemoryDays;
  const previousTz = process.env.TZ;

  beforeEach(async () => {
    delete process.env.TZ;
    zone = new MemoryZone();
    days = new MemoryDays({ marks: [], intentions: [], scheduled: [{ id: "t1", title: "Dentist", scheduledDay: OLD_BRUSSELS, scheduledTime: "09:30" }] });
    app = Fastify();
    await app.register(authPlugin, { token: "test-token", apiKeys: { verify: async (k: string) => k === "generated-key" } as never });
    const service = new TimeZoneService(zone);
    await service.load();
    app.decorate("zones", service);
    await timeZoneRoutes(app, { service, days, log: quiet });
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

  it("before the app reports: UTC, and the old scheduled days wait for a zone", async () => {
    const res = await app.inject({ method: "GET", url: "/settings/time-zone", headers: owner });
    expect(res.json()).toEqual({ zone: "UTC", source: "default", reported: null, oldScheduledDays: { count: 1, reason: "no-zone" } });
    expect((await app.inject({ method: "GET", url: "/clock" })).json()).toEqual({ timeZone: "UTC" });
  });

  it("the first report sets the zone for callers without one, and moves the old scheduled days", async () => {
    const res = await put("Europe/Brussels");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ zone: "Europe/Brussels", source: "app", reported: "Europe/Brussels", oldScheduledDays: { count: 0, reason: null } });
    expect(days.applied[0]!.scheduled.map((m) => m.to.toISOString())).toEqual(["2026-11-26T00:00:00.000Z"]);
    // An MCP-like caller (no header) now means Brussels; a device still means its own zone.
    expect((await app.inject({ method: "GET", url: "/clock" })).json()).toEqual({ timeZone: "Europe/Brussels" });
    expect((await app.inject({ method: "GET", url: "/clock", headers: { "x-time-zone": "America/New_York" } })).json()).toEqual({
      timeZone: "America/New_York",
    });
  });

  it("writes only a change, and runs the move only on the first report", async () => {
    await put("Europe/Brussels");
    await put("Europe/Brussels");
    expect(zone.writes).toBe(1);
    await put("America/New_York");
    expect(zone.writes).toBe(2);
    expect(days.applied).toHaveLength(1);
  });

  it("refuses the move as a whole when a value fits no known zone, and says so", async () => {
    days.days.scheduled!.push({ id: "t2", title: "Call", scheduledDay: new Date("2026-12-03T05:00:00.000Z"), scheduledTime: null }); // New York
    const res = await put("Europe/Brussels");
    expect(days.applied).toEqual([]);
    expect(res.json().oldScheduledDays).toEqual({ count: 2, reason: "refused" });
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
    expect((await app.inject({ method: "GET", url: "/settings/time-zone", headers: owner })).json()).toMatchObject({
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

describe("scheduled days over the task routes (#136)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: { ...loadConfig(), authToken: "test-token", isProduction: false },
      timeZones: new TimeZoneService(new MemoryZone()),
      days: new MemoryDays({ marks: [], intentions: [] }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("takes a plain date as it is, and (for one release) an older app's local midnight as its day in the caller's zone", () => {
    const req = (headers: Record<string, string>) => ({ headers, server: { hasDecorator: () => false } }) as never;
    expect(scheduledDayInput("2026-11-26", req({})).toISOString()).toBe("2026-11-26T00:00:00.000Z");
    expect(scheduledDayInput("2026-11-26", req({ "x-time-zone": "America/New_York" })).toISOString()).toBe("2026-11-26T00:00:00.000Z");
    // LEGACY (#137): Thursday from a Brussels app that has not updated yet.
    expect(scheduledDayInput("2026-11-25T23:00:00.000Z", req({ "x-time-zone": "Europe/Brussels" })).toISOString()).toBe("2026-11-26T00:00:00.000Z");
  });

  it("refuses a scheduled day that is neither a date nor a date-time", async () => {
    const res = await app.inject({ method: "POST", url: "/api/tasks", headers: owner, payload: { title: "x", scheduledDay: "Thursday" } });
    expect(res.statusCode).toBe(400);
  });
});
