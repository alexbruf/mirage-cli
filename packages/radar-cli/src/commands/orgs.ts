/**
 * Multi-org subcommands: list, use, current, clear. Ported from the prod
 * `ve-radar` CLI. `orgs use` persists the active org id to the on-disk session
 * (~/.config/radar/session.json); every later request then sends it as
 * `X-Active-Org-Id`. Override for a single command with the program-level
 * `--org` flag (or the `RADAR_ACTIVE_ORG_ID` env var).
 */
import type { Command } from "commander";
import type { ApiClient } from "../client.ts";
import { loadFileSession, setActiveOrg } from "../config.ts";

interface Org {
  id: string;
  name: string;
  slug: string | null;
  role?: string;
}

export function registerOrgsCommands(
  program: Command,
  getClient: () => Promise<ApiClient>,
): void {
  const orgs = program.command("orgs").description("List and switch organizations");

  orgs
    .command("list")
    .description("List the orgs you're a member of")
    .action(async () => {
      const data = await (await getClient()).list<Org>("orgs");
      const active = loadFileSession()?.activeOrgId ?? process.env.RADAR_ACTIVE_ORG_ID;
      const rows = data.rows.map((o) => ({ ...o, active: o.id === active }));
      console.log(
        JSON.stringify({ rows, total: data.total, active_org_id: active ?? null }, null, 2),
      );
    });

  orgs
    .command("use <id-or-slug>")
    .description("Set the active org. Accepts an org ID or slug.")
    .action(async (idOrSlug: string) => {
      const data = await (await getClient()).list<Org>("orgs");
      const match = data.rows.find((o) => o.id === idOrSlug || o.slug === idOrSlug);
      if (!match) {
        console.error(`Org not found: ${idOrSlug}`);
        console.error("Available orgs:");
        for (const o of data.rows) {
          console.error(`  ${o.id}  (${o.slug ?? "no-slug"})  — ${o.name}`);
        }
        process.exit(1);
      }
      setActiveOrg(match.id);
      console.error(`✓ Active org: ${match.name} (${match.id})`);
    });

  orgs
    .command("current")
    .description("Print the active org")
    .action(() => {
      const active = process.env.RADAR_ACTIVE_ORG_ID ?? loadFileSession()?.activeOrgId;
      if (!active) {
        console.error(
          "No active org set — using your default. Run `radar orgs use <id>` to set one.",
        );
        return;
      }
      console.log(active);
    });

  orgs
    .command("clear")
    .description("Clear the active org override (revert to default)")
    .action(() => {
      setActiveOrg(null);
      console.error("✓ Active org cleared.");
    });
}
