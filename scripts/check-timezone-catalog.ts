/**
 * M8H.2 — TIMEZONE CATALOG COMPATIBILITY GATE.
 *
 * The Settings picker offers the RUNTIME's canonical IANA zones (Node/ICU), but
 * every saved value is validated by PostgreSQL against `pg_timezone_names`. Those
 * are two different timezone databases on two different release cadences. If ICU
 * knows a zone Postgres doesn't, the UI would advertise an option the RPC rejects
 * — a broken setting the user can select but never save.
 *
 * This gate proves the two agree, in the only direction that can hurt a user:
 *
 *     every timezone the UI can OFFER  ⊆  every timezone the DATABASE ACCEPTS
 *
 * It asserts against the REAL validator (`public._is_valid_timezone`), not against
 * a copy of its rules, so a change to the validator cannot silently pass.
 *
 * LOCAL-STACK ONLY. It talks to the local `supabase` database over psql, never to
 * hosted staging, and it uses no service-role key (the check needs no privileges
 * beyond calling a stable helper). Same posture as `supabase db lint`: it needs
 * Docker + the CLI, so it runs in the pre-merge gate rather than in CI.
 *
 *   npm run check:timezone-catalog
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { TIME_ZONE_OPTIONS } from "../src/lib/time";

/** The local dev database only — never a hosted project. */
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function fail(message: string): never {
  console.error(`\n[timezone-catalog] FAIL — ${message}\n`);
  process.exit(1);
}

const PSQL_ARGS = ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align"];

/**
 * Run a query against the LOCAL stack. Prefers a `psql` on PATH; falls back to the
 * one inside the local Supabase database container, so this works on a machine that
 * only has the Supabase CLI + Docker (the documented local setup) and never needs a
 * separate PostgreSQL client install.
 */
function runLocalSql(sql: string): string {
  try {
    return execFileSync("psql", [LOCAL_DB_URL, ...PSQL_ARGS, "-c", sql], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // No psql on PATH — use the client inside the local Supabase db container.
  }
  const project = basename(process.cwd());
  const container = `supabase_db_${project}`;
  try {
    return execFileSync(
      "docker",
      ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", ...PSQL_ARGS, "-c", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(
      `could not reach the LOCAL database. Start it with \`supabase start\` and apply ` +
        `the migrations with \`supabase db reset\` (tried psql on PATH, then the ` +
        `\`${container}\` container).\n${detail}`,
    );
  }
}

const zones = [...TIME_ZONE_OPTIONS];
console.log(`[timezone-catalog] app offers ${zones.length} timezones`);

// ── App-side invariants (no database needed) ──────────────────────────────
if (!zones.includes("UTC")) fail("UTC must always be selectable");
if (new Set(zones).size !== zones.length) fail("the option list contains duplicates");

const offsets = zones.filter((z) => /^[+-]/.test(z) || /^(utc|gmt)\s*[+-]/i.test(z));
if (offsets.length > 0) fail(`fixed UTC offsets are selectable: ${offsets.join(", ")}`);

const aliases = zones.filter((z) => /^(posix|right)\//.test(z) || z === "Factory");
if (aliases.length > 0) fail(`internal aliases are selectable: ${aliases.join(", ")}`);

// ── The real check: PostgreSQL must accept every one of them ──────────────
// Send the list as a single array literal and let the DATABASE's own validator
// judge each name. One round trip; nothing but zone names crosses the wire.
// Zone names are [A-Za-z0-9_/+-] only; reject anything else rather than build a
// literal out of it (nothing user-supplied reaches here, but the list is data).
const suspicious = zones.filter((z) => !/^[A-Za-z0-9_/+-]+$/.test(z));
if (suspicious.length > 0) fail(`unexpected characters in: ${suspicious.join(", ")}`);

const arrayLiteral = zones.map((z) => `"${z}"`).join(",");
const out = runLocalSql(`
  select z as name
  from unnest('{${arrayLiteral}}'::text[]) as z
  where not public._is_valid_timezone(z);
`);

const rejected = out.split("\n").map((l) => l.trim()).filter(Boolean);
if (rejected.length > 0) {
  fail(
    `${rejected.length} selectable timezone(s) are REJECTED by the database validator ` +
      `— the Settings UI would offer an option that cannot be saved:\n  ${rejected.join("\n  ")}`,
  );
}

console.log(
  `[timezone-catalog] OK — all ${zones.length} selectable timezones are accepted by ` +
    `public._is_valid_timezone (UTC included, no fixed offsets, no posix/right/Factory aliases)`,
);
