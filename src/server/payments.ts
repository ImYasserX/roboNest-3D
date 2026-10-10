import "server-only";
import { getServerVar, reportMissingConfig } from "@/server/env";
import { createFibProvider, type DepositProvider } from "@/server/integrations/fib";

/**
 * The online deposit provider, or null. FIB is only active when an owner
 * explicitly sets FIB_ONLINE_DEPOSITS=enabled AND the merchant credentials
 * exist; the guide requires a verified sandbox transaction before that.
 */
export async function getDepositProvider(): Promise<DepositProvider | null> {
  const [flag, baseUrl, clientId, clientSecret] = await Promise.all([
    getServerVar("FIB_ONLINE_DEPOSITS"),
    getServerVar("FIB_BASE_URL"),
    getServerVar("FIB_CLIENT_ID"),
    getServerVar("FIB_CLIENT_SECRET"),
  ]);
  if (flag !== "enabled") return null;
  if (!baseUrl || !clientId || !clientSecret || !/^https:\/\//.test(baseUrl)) {
    reportMissingConfig("FIB online deposits", [!baseUrl && "FIB_BASE_URL (https)", !clientId && "FIB_CLIENT_ID", !clientSecret && "FIB_CLIENT_SECRET"].filter(Boolean) as string[]);
    return null;
  }
  return createFibProvider({ baseUrl, clientId, clientSecret });
}
