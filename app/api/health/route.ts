import { queryOne } from "@/lib/db/client";
import { features } from "@/lib/env";
import { hasModelProvider } from "@/lib/llm";
import { activeRunCount } from "@/lib/runs/manager";
import { apiOk } from "@/lib/api";

/**
 * Render's health check path.
 *
 * Reports which providers are CONFIGURED, not which ones work — a health probe
 * that burns a model call on every hit is its own outage. `npm run doctor`
 * actually calls each provider and is the thing to run when a key looks wrong.
 */
export async function GET() {
  let database = false;
  try {
    await queryOne("select 1 as ok");
    database = true;
  } catch {
    database = false;
  }

  const ready = database && hasModelProvider() && features.exa && features.firecrawl;

  return apiOk(
    {
      status: ready ? "ok" : "degraded",
      database,
      activeRuns: activeRunCount(),
      // Presence of credentials, not proof they work. Run `npm run doctor` for that.
      configured: {
        model: hasModelProvider(),
        exa: features.exa,
        firecrawl: features.firecrawl,
        enrichment: features.enrichment,
        up2data: features.up2data,
        storage: features.storage ? "object-storage" : "postgres-fallback",
        gmail: features.gmail,
      },
    },
    database ? 200 : 503
  );
}
