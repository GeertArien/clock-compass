import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { RenewalService } from "@clock-compass/core";
import { FakeHabitRepository } from "@clock-compass/core/testing";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { checkServerZone } from "../time-zone.js";

/**
 * Habits and renewal over HTTP (#112): "today" is the device's when the
 * request carries X-Time-Zone, the server's (TZ) otherwise. The server here
 * runs in Brussels and the clock is fixed; the renewal service runs on an
 * in-memory repository.
 */
describe("habit routes: whose today", () => {
  let app: FastifyInstance;
  let repo: FakeHabitRepository;
  const previousTz = process.env.TZ;
  const auth = { authorization: "Bearer test-token" };
  const NEW_YORK = { ...auth, "x-time-zone": "America/New_York" };

  beforeAll(async () => {
    process.env.TZ = "Europe/Brussels";
    repo = new FakeHabitRepository();
    app = await buildApp({
      config: { ...loadConfig(), authToken: "test-token", isProduction: false },
      renewalService: new RenewalService(repo),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  beforeEach(() => {
    // 23:00 on Tuesday 24 November in New York; already Wednesday 25 in Brussels.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T04:00:00Z"));
    repo.habits.clear();
    repo.intentions = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createHabit = async () =>
    (await app.inject({ method: "POST", url: "/api/habits", headers: auth, payload: { name: "Journal" } })).json<{ id: string }>();

  it("checks off on the device's day when the header and TZ differ", async () => {
    const habit = await createHabit();
    const res = await app.inject({ method: "POST", url: `/api/habits/${habit.id}/toggle`, headers: NEW_YORK, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().markedToday).toBe(true);
    expect(repo.marks.map((m) => m.day.toISOString())).toEqual(["2026-11-24T00:00:00.000Z"]);

    // The same device reads it as today; a caller without a zone gets Brussels' today.
    const device = await app.inject({ method: "GET", url: "/api/habits", headers: NEW_YORK });
    expect(device.json()[0].markedToday).toBe(true);
    const server = await app.inject({ method: "GET", url: "/api/habits", headers: auth });
    expect(server.json()[0].markedToday).toBe(false);
  });

  it("checks off on the server's day without the header", async () => {
    const habit = await createHabit();
    await app.inject({ method: "POST", url: `/api/habits/${habit.id}/toggle`, headers: auth, payload: {} });
    expect(repo.marks.map((m) => m.day.toISOString())).toEqual(["2026-11-25T00:00:00.000Z"]);
  });

  it("takes an earlier day as a plain date, and refuses a day to come or a date-time", async () => {
    const habit = await createHabit();
    const earlier = await app.inject({ method: "POST", url: `/api/habits/${habit.id}/toggle`, headers: NEW_YORK, payload: { day: "2026-11-23" } });
    expect(earlier.statusCode).toBe(200);
    expect(repo.marks.map((m) => m.day.toISOString())).toEqual(["2026-11-23T00:00:00.000Z"]);

    // The 25th is still to come in New York.
    const toCome = await app.inject({ method: "POST", url: `/api/habits/${habit.id}/toggle`, headers: NEW_YORK, payload: { day: "2026-11-25" } });
    expect(toCome.statusCode).toBe(400);
    expect(toCome.json().error).toMatch(/future/i);

    const instant = await app.inject({
      method: "POST",
      url: `/api/habits/${habit.id}/toggle`,
      headers: NEW_YORK,
      payload: { day: "2026-11-23T00:00:00.000Z" },
    });
    expect(instant.statusCode).toBe(400);
  });

  it("keeps this week's intention per the device's week", async () => {
    // Sunday 29 November 20:00 in New York = Monday 30 November 02:00 in Brussels.
    vi.setSystemTime(new Date("2026-11-30T01:00:00Z"));
    await app.inject({ method: "PUT", url: "/api/renewal/intentions/MENTAL", headers: NEW_YORK, payload: { text: "Read" } });
    expect(repo.intentions[0]!.weekStart.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    const device = await app.inject({ method: "GET", url: "/api/renewal/intentions", headers: NEW_YORK });
    expect(device.json()).toEqual([{ dimension: "MENTAL", text: "Read" }]);
    const server = await app.inject({ method: "GET", url: "/api/renewal/intentions", headers: auth });
    expect(server.json()).toEqual([]);
  });

  it("falls back to the server's zone for a header it does not know", async () => {
    const habit = await createHabit();
    await app.inject({ method: "POST", url: `/api/habits/${habit.id}/toggle`, headers: { ...auth, "x-time-zone": "Mars/Olympus" }, payload: {} });
    expect(repo.marks.map((m) => m.day.toISOString())).toEqual(["2026-11-25T00:00:00.000Z"]);
  });
});

describe("the server's zone at start-up", () => {
  it("accepts a known zone, no zone and an empty one (#136: not set)", () => {
    expect(checkServerZone({ TZ: "Europe/Brussels" })).toEqual({ ok: true });
    expect(checkServerZone({})).toEqual({ ok: true });
    expect(checkServerZone({ TZ: "" })).toEqual({ ok: true });
  });

  it("refuses a zone Node would silently replace with UTC", () => {
    expect(checkServerZone({ TZ: "Europe/Brusels" })).toEqual({ error: expect.stringContaining('TZ="Europe/Brusels"') });
  });
});
