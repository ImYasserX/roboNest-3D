import { redact, withTimeout, type FetchLike } from "./http";

// First Iraqi Bank (FIB) Online Payments, per the public documentation
// (https://fib.iq/integrations/web-payments/): OAuth2 client credentials,
// POST /protected/v1/payments, GET /protected/v1/payments/{id}/status.
//
// NOT VERIFIED against a real FIB transaction from this codebase yet. It is
// inactive until FIB_ONLINE_DEPOSITS=enabled and credentials exist, and the
// rollout guide requires a sandbox payment before enabling it in production.
//
// Trust model: the only source of truth is the authenticated status endpoint.
// Callback bodies are never trusted; they only trigger a status re-check.

export type FibConfig = { baseUrl: string; clientId: string; clientSecret: string };

export type ProviderStatus = {
  status: "PAID" | "UNPAID" | "DECLINED";
  amount: number | null;
  currency: string | null;
  paidAt: Date | null;
  declineReason: string | null;
};

export type CreatedPayment = {
  providerPaymentId: string;
  validUntil: Date | null;
  payInfo: Record<string, string | null>;
};

export type DepositProvider = {
  name: "FIB";
  createPayment(input: { amount: number; callbackUrl: string; description: string }): Promise<{ ok: true; payment: CreatedPayment } | { ok: false; detail: string }>;
  getStatus(providerPaymentId: string): Promise<{ ok: true; status: ProviderStatus } | { ok: false; detail: string }>;
};

const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

export function createFibProvider(config: FibConfig, fetchImpl: FetchLike = fetch): DepositProvider {
  const base = config.baseUrl.replace(/\/+$/, "");
  const secrets = [config.clientSecret];

  async function token(): Promise<string | null> {
    const res = await fetchImpl(`${base}/auth/realms/fib-online-shop/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }).toString(),
      signal: withTimeout(),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as { access_token?: string };
    return typeof json.access_token === "string" ? json.access_token : null;
  }

  return {
    name: "FIB",
    async createPayment({ amount, callbackUrl, description }) {
      try {
        const access = await token();
        if (!access) return { ok: false, detail: "fib auth failed" };
        const res = await fetchImpl(`${base}/protected/v1/payments`, {
          method: "POST",
          headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
          body: JSON.stringify({ monetaryValue: { amount, currency: "IQD" }, statusCallbackUrl: callbackUrl, description: description.slice(0, 50) }),
          signal: withTimeout(),
        });
        if (!res.ok) return { ok: false, detail: redact(`create ${res.status} ${await res.text().catch(() => "")}`, secrets) };
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const id = str(j.paymentId);
        if (!id) return { ok: false, detail: "create: no paymentId" };
        return {
          ok: true,
          payment: {
            providerPaymentId: id,
            validUntil: date(j.validUntil),
            payInfo: {
              readableCode: str(j.readableCode),
              personalAppLink: str(j.personalAppLink),
              businessAppLink: str(j.businessAppLink),
              corporateAppLink: str(j.corporateAppLink),
              qrCode: str(j.qrCode),
            },
          },
        };
      } catch (error) {
        return { ok: false, detail: redact(`create network ${String((error as Error)?.name ?? error)}`, secrets) };
      }
    },
    async getStatus(providerPaymentId) {
      try {
        const access = await token();
        if (!access) return { ok: false, detail: "fib auth failed" };
        const res = await fetchImpl(`${base}/protected/v1/payments/${encodeURIComponent(providerPaymentId)}/status`, {
          headers: { Authorization: `Bearer ${access}` },
          signal: withTimeout(),
        });
        if (!res.ok) return { ok: false, detail: `status ${res.status}` };
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const status = j.status;
        if (status !== "PAID" && status !== "UNPAID" && status !== "DECLINED") return { ok: false, detail: "status: unknown value" };
        if (str(j.paymentId) !== providerPaymentId) return { ok: false, detail: "status: payment id mismatch" };
        const amount = (j.amount ?? {}) as Record<string, unknown>;
        const value = typeof amount.amount === "number" ? amount.amount : typeof amount.amount === "string" ? Number(amount.amount) : null;
        return {
          ok: true,
          status: { status, amount: value !== null && Number.isFinite(value) ? value : null, currency: str(amount.currency), paidAt: date(j.paidAt), declineReason: str(j.decliningReason) },
        };
      } catch (error) {
        return { ok: false, detail: `status network ${String((error as Error)?.name ?? "error")}` };
      }
    },
  };
}
