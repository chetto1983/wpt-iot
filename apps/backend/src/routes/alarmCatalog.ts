import { createRequire } from 'node:module';
import type { FastifyPluginAsync } from 'fastify';
import { UserRole } from '@wpt/types';
import { requireRole } from '../auth/authHooks.js';
import { ALARM_CATALOG_VERSION } from '../mqtt/alarmCatalogVersion.js';

/**
 * Alarm catalog endpoint — GET /alarms/catalog
 *
 * Returns the full bilingual alarm description catalog keyed by alarm index
 * (0..639). Intended for cloud partner integrators who need human-readable
 * descriptions for the alarm indices carried in the Sparkplug B wire format.
 *
 * Auth: session cookie (WPT or SUPER_ADMIN role).
 *   Machine-scoped API key auth is NOT implemented in v2.0.0 — flagged as
 *   v2.1.0 work. Partners who need keyless access should contact WPT s.r.l.
 *
 * Query params:
 *   lang  — "en" | "it" (default: "en"). Case-sensitive. Unknown values → 400.
 *
 * Response schema (application/json):
 *   {
 *     version:      string,            // alarm catalog semver (from ALARM_CATALOG_VERSION)
 *     lang:         "en" | "it",
 *     generated_at: string,            // ISO 8601 UTC timestamp of this response
 *     alarms: {
 *       [index: string]: {
 *         description: string,         // human-readable; empty string for spare slots
 *         priority: null               // ISA 18.2 priority — TBD in v2.1.0 (null for all)
 *       }
 *     }
 *   }
 *
 * Priority note: the en.json / it.json catalogs do NOT contain ISA 18.2 priority
 * fields. All entries carry `priority: null` in this release. A canonical priority
 * mapping is deferred to v2.1.0 pending input from WPT s.r.l. engineering.
 */

const SUPPORTED_LANGS = ['en', 'it'] as const;
type SupportedLang = typeof SUPPORTED_LANGS[number];

// Load catalogs at module init time (startup cache). The JSON files are static
// and do not change at runtime — reading once per process is correct.
const _require = createRequire(import.meta.url);

const RAW_CATALOGS: Record<SupportedLang, Record<string, string>> = {
  en: _require('../i18n/alarms/en.json') as Record<string, string>,
  it: _require('../i18n/alarms/it.json') as Record<string, string>,
};

// Pre-build the shaped catalog entries (description + priority: null) for each lang.
// Done once at startup so each request is a simple object lookup.
type AlarmEntry = { description: string; priority: null };
const CATALOGS: Record<SupportedLang, Record<string, AlarmEntry>> = {
  en: buildCatalog(RAW_CATALOGS.en),
  it: buildCatalog(RAW_CATALOGS.it),
};

function buildCatalog(raw: Record<string, string>): Record<string, AlarmEntry> {
  const out: Record<string, AlarmEntry> = {};
  for (const [index, description] of Object.entries(raw)) {
    out[index] = { description, priority: null };
  }
  return out;
}

export const alarmCatalogRoutes: FastifyPluginAsync = async (server) => {
  server.addHook('preHandler', requireRole(UserRole.WPT, UserRole.SUPER_ADMIN));

  /**
   * GET /alarms/catalog?lang=en
   * Mounted at /api/alarms/catalog via server.ts apiOpts prefix.
   */
  server.get('/alarms/catalog', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const rawLang = query.lang ?? 'en';

    if (!SUPPORTED_LANGS.includes(rawLang as SupportedLang)) {
      return reply.code(400).send({
        error: `Unsupported lang "${rawLang}". Allowed values: ${SUPPORTED_LANGS.join(', ')}.`,
      });
    }

    const lang = rawLang as SupportedLang;

    return reply.send({
      version: ALARM_CATALOG_VERSION,
      lang,
      generated_at: new Date().toISOString(),
      alarms: CATALOGS[lang],
    });
  });
};
