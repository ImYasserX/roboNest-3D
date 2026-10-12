import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getServerVar, outboundIntegrationsDisabled } from "@/server/env";
import { notificationEvents } from "@/server/db/schema";
import { dispatchPending, suppressNotifications } from "@/server/services/notifications";
import { fakeFetch, json } from "../support/fakes";
import { startPlatform, type TestPlatform } from "../support/platform";

let p: TestPlatform;
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

describe("automated runs can never reach real providers", () => {
  it("the test environment contains no provider credentials from .dev.vars", () => {
    const keys = Object.keys(p.env as unknown as Record<string, unknown>);
    expect(keys.filter((k) => /^(RESEND|TELEGRAM|TWILIO|WHATSAPP|FIB)_/.test(k))).toEqual([]);
    expect((p.env as unknown as Record<string, unknown>).OUTBOUND_INTEGRATIONS).toBe("disabled");
  });

  it("the kill switch hides provider credentials even when they are present", async () => {
    const env = p.env as unknown as Record<string, unknown>;
    Object.assign(env, { RESEND_API_KEY: "re_should_be_hidden_123", TELEGRAM_BOT_TOKEN: "123:hidden", CONTACT_FORM_EMAIL: "contact@robonest.tech" });
    expect(await outboundIntegrationsDisabled()).toBe(true);
    expect(await getServerVar("RESEND_API_KEY")).toBeUndefined();
    expect(await getServerVar("TELEGRAM_BOT_TOKEN")).toBeUndefined();
    // Non-secret configuration stays readable.
    expect(await getServerVar("CONTACT_FORM_EMAIL")).toBe("contact@robonest.tech");
    // Without the switch the binding is used (production behaviour).
    env.OUTBOUND_INTEGRATIONS = undefined;
    expect(await getServerVar("RESEND_API_KEY")).toBe("re_should_be_hidden_123");
    Object.assign(env, { OUTBOUND_INTEGRATIONS: "disabled", RESEND_API_KEY: undefined, TELEGRAM_BOT_TOKEN: undefined, CONTACT_FORM_EMAIL: undefined });
  });

  it("alerts created while sending is disabled are suppressed for good, never delivered later", async () => {
    const id = crypto.randomUUID();
    await p.db.insert(notificationEvents).values({ id, kind: "ORDER_PLACED", dedupeKey: `ORDER_PLACED:test-${id}`, payload: { orderNumber: "RN-261012-TESTAA", total: 1 }, status: "NOT_CONFIGURED", nextAttemptAt: new Date(Date.now() - 1000) });
    await suppressNotifications(p.db, [id]);
    // Later, real credentials appear and the automatic retry runs: nothing is sent.
    const f = fakeFetch(json({ ok: true }));
    await dispatchPending(p.db, { token: "123:abc", chatIds: ["1111", "2222"], siteUrl: "http://x" }, [], { fetchImpl: f.fetchImpl, limit: 100 });
    expect(f.calls).toHaveLength(0);
    expect((await p.db.select().from(notificationEvents).where(eq(notificationEvents.id, id)))[0]).toMatchObject({ status: "SUPPRESSED", nextAttemptAt: null, sentAt: null });
  });
});
