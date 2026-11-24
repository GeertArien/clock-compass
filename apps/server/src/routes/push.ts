import type { FastifyInstance } from "fastify";
import webpush from "web-push";
import {
  PeopleService,
  TaskService,
  PrismaCommitmentRepository,
  PrismaPersonRepository,
  PrismaPushRepository,
  PrismaTaskRepository,
  dueNotifications,
  fallbackZone,
  notificationFacts,
  prisma,
  type PendingNotification,
} from "@clock-compass/core";

export interface PushRouteOptions {
  vapidPublicKey: string | undefined;
  vapidPrivateKey: string | undefined;
  vapidSubject: string | undefined;
  /** Disable the interval in tests. */
  startScheduler?: boolean;
}

/**
 * Web push (build-order step 9). Subscriptions are stored per device; a small
 * scheduler wakes every 15 minutes and asks the pure `dueNotifications`
 * judgment what to send. With no VAPID keys configured, routes answer 503 and
 * nothing is scheduled — the app works fine without push.
 */
export async function pushRoutes(
  fastify: FastifyInstance,
  options: PushRouteOptions,
): Promise<void> {
  const repo = new PrismaPushRepository(prisma);
  const configured = !!(options.vapidPublicKey && options.vapidPrivateKey);
  if (configured) {
    webpush.setVapidDetails(
      options.vapidSubject ?? "mailto:admin@example.com",
      options.vapidPublicKey!,
      options.vapidPrivateKey!,
    );
  }

  const tasks = new TaskService(new PrismaTaskRepository(prisma));
  const people = new PeopleService(
    new PrismaPersonRepository(prisma),
    new PrismaCommitmentRepository(prisma),
  );

  async function sendToAll(notification: PendingNotification): Promise<void> {
    const payload = JSON.stringify(notification);
    for (const sub of await repo.listSubscriptions()) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err) {
        // 404/410 = the browser dropped the subscription — clean it up.
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await repo.deleteSubscription(sub.endpoint);
        } else {
          fastify.log.warn({ err }, "push delivery failed");
        }
      }
    }
  }

  /** One scheduler pass: judge, send, stamp. Exposed for the test route. */
  async function tick(now: Date = new Date()): Promise<PendingNotification[]> {
    if (!configured) return [];
    const settings = await repo.getSettings();
    // Hours and days in the fallback zone (#136): TZ, else the zone the app
    // reported (on this same row), else UTC.
    const zone = fallbackZone(settings.timeZone).zone;
    const pending = dueNotifications(settings, await notificationFacts({ people, tasks }, now), now, zone);
    for (const notification of pending) {
      await sendToAll(notification);
      const stamp =
        notification.kind === "overdue"
          ? { lastOverdueSentAt: now }
          : notification.kind === "morningRocks"
            ? { lastMorningSentAt: now }
            : { lastReviewSentAt: now };
      await repo.updateSettings(stamp);
    }
    return pending;
  }

  if (configured && options.startScheduler !== false) {
    const interval = setInterval(
      () => void tick().catch((err) => fastify.log.warn({ err }, "push tick failed")),
      15 * 60 * 1000,
    );
    interval.unref?.();
    fastify.addHook("onClose", async () => clearInterval(interval));
  }

  const errorSchema = {
    type: "object",
    properties: { error: { type: "string" } },
  } as const;
  const settingsSchema = {
    type: "object",
    properties: {
      overdueCommitments: { type: "boolean" },
      morningRocks: { type: "boolean" },
      weeklyReview: { type: "boolean" },
      morningHour: { type: "integer" },
      quietStart: { type: "integer" },
      quietEnd: { type: "integer" },
    },
  } as const;

  const auth = { preHandler: fastify.requireAuth };
  const secured = [{ bearerAuth: [] }];
  const PUSH_DISABLED = {
    error: "Push is disabled — set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY on the server.",
  };

  fastify.get(
    "/push/status",
    {
      ...auth,
      schema: {
        description: "Whether web push is configured, and the public VAPID key.",
        tags: ["push"],
        security: secured,
        response: {
          200: {
            type: "object",
            properties: {
              configured: { type: "boolean" },
              publicKey: { type: ["string", "null"] },
              subscriptions: { type: "integer" },
            },
          },
        },
      },
    },
    async () => ({
      configured,
      publicKey: options.vapidPublicKey ?? null,
      subscriptions: (await repo.listSubscriptions()).length,
    }),
  );

  fastify.post(
    "/push/subscribe",
    {
      ...auth,
      schema: {
        description: "Register this browser's push subscription.",
        tags: ["push"],
        security: secured,
        body: {
          type: "object",
          required: ["endpoint", "keys"],
          properties: {
            endpoint: { type: "string", minLength: 1 },
            keys: {
              type: "object",
              required: ["p256dh", "auth"],
              properties: {
                p256dh: { type: "string" },
                auth: { type: "string" },
              },
            },
          },
        },
        response: { 201: { type: "object", properties: { ok: { type: "boolean" } } }, 503: errorSchema },
      },
    },
    async (req, reply) => {
      if (!configured) return reply.code(503).send(PUSH_DISABLED);
      const body = req.body as { endpoint: string; keys: { p256dh: string; auth: string } };
      await repo.saveSubscription({
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      });
      reply.code(201);
      return { ok: true };
    },
  );

  fastify.post(
    "/push/unsubscribe",
    {
      ...auth,
      schema: {
        description: "Remove this browser's push subscription.",
        tags: ["push"],
        security: secured,
        body: {
          type: "object",
          required: ["endpoint"],
          properties: { endpoint: { type: "string" } },
        },
        response: { 204: { type: "null" } },
      },
    },
    async (req, reply) => {
      await repo.deleteSubscription((req.body as { endpoint: string }).endpoint);
      reply.code(204);
    },
  );

  fastify.get(
    "/notifications/settings",
    {
      ...auth,
      schema: {
        description: "Notification preferences (toggles, morning hour, quiet hours).",
        tags: ["push"],
        security: secured,
        response: { 200: settingsSchema },
      },
    },
    async () => repo.getSettings(),
  );

  fastify.put(
    "/notifications/settings",
    {
      ...auth,
      schema: {
        description: "Update notification preferences.",
        tags: ["push"],
        security: secured,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            overdueCommitments: { type: "boolean" },
            morningRocks: { type: "boolean" },
            weeklyReview: { type: "boolean" },
            morningHour: { type: "integer", minimum: 0, maximum: 23 },
            quietStart: { type: "integer", minimum: 0, maximum: 23 },
            quietEnd: { type: "integer", minimum: 0, maximum: 23 },
          },
        },
        response: { 200: settingsSchema },
      },
    },
    async (req) => repo.updateSettings(req.body as Record<string, never>),
  );

  fastify.post(
    "/push/test",
    {
      ...auth,
      schema: {
        description: "Send a test notification to every subscribed device.",
        tags: ["push"],
        security: secured,
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } }, 503: errorSchema },
      },
    },
    async (_req, reply) => {
      if (!configured) return reply.code(503).send(PUSH_DISABLED);
      await sendToAll({
        kind: "overdue",
        title: "Clock & Compass",
        body: "Push is working — first things first.",
        url: "/",
      });
      return { ok: true };
    },
  );
}
