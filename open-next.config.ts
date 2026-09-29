import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache is configured: every storefront page reads live data
// from D1 and is rendered per request, so there is nothing to revalidate.
// See ARCHITECTURE.md ("Caching") before enabling one.
export default defineCloudflareConfig({});
