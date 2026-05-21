import { Command, CommanderError } from "commander";
import { setCredentialsPath, setProfile, version } from "./auth.ts";
import {
  loadOAuthState,
  login as oauthLogin,
  logout as oauthLogout,
  oauthFilePath,
  refreshIfNeeded,
} from "./oauth.ts";
import { registerAdminCommands } from "./commands/admin.ts";
import { registerProfilesCommands } from "./commands/profiles.ts";
import { registerReportingCommands } from "./commands/reporting.ts";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("ga4")
    .description(
      "Google Analytics 4 CLI — wraps the GA4 Data + Admin APIs. " +
        "Auth: service-account JSON (--credentials/--profile), OAuth (`ga4 login` or GA4_OAUTH_ACCESS_TOKEN env), or Application Default Credentials.",
    )
    .addHelpText(
      "after",
      "\nVendored from Bin-Huang/google-analytics-cli (Apache-2.0).\nDocs: https://github.com/Bin-Huang/google-analytics-cli",
    )
    .version(version)
    .option(
      "--format <format>",
      "Output format",
      (value: string) => {
        if (!["json", "compact"].includes(value)) {
          throw new Error("Format must be 'json' or 'compact'.");
        }
        return value;
      },
      "json",
    )
    .option(
      "--property <id>",
      "GA4 property ID (or set GA_PROPERTY_ID)",
      process.env.GA_PROPERTY_ID,
    )
    .option("--credentials <path>", "Path to service account JSON key file")
    .option(
      "--profile <name>",
      "Named credentials profile under ~/.config/google-analytics-cli/profiles/ (or set GA_PROFILE)",
      process.env.GA_PROFILE,
    );

  program.exitOverride();
  program.configureOutput({
    writeErr: (str: string) =>
      process.stderr.write(JSON.stringify({ error: str.trim() }) + "\n"),
    writeOut: (str: string) => process.stdout.write(str),
  });

  program.hook("preAction", (thisCommand: Command) => {
    const { credentials, profile } = thisCommand.optsWithGlobals();
    if (credentials && profile) {
      throw new Error(
        "--credentials and --profile cannot be used together. Use one or the other.",
      );
    }
    if (credentials) setCredentialsPath(credentials);
    if (profile) setProfile(profile);
  });

  registerAdminCommands(program);
  registerReportingCommands(program);
  registerProfilesCommands(program);
  registerAuthCommands(program);

  return program;
}

function registerAuthCommands(program: Command): void {
  program
    .command("login")
    .description(
      "Interactive Google OAuth (PKCE loopback). Requires GA4_OAUTH_CLIENT_ID env var (and optionally GA4_OAUTH_CLIENT_SECRET).",
    )
    .option("--client-id <id>", "OAuth client_id (overrides GA4_OAUTH_CLIENT_ID)")
    .option("--client-secret <secret>", "OAuth client_secret (overrides GA4_OAUTH_CLIENT_SECRET)")
    .option("--scopes <scopes>", "OAuth scopes (space-separated)")
    .option("--port <port>", "Loopback port", (v: string) => parseInt(v, 10))
    .action(
      async (opts: {
        clientId?: string;
        clientSecret?: string;
        scopes?: string;
        port?: number;
      }) => {
        const state = await oauthLogin({
          ...(opts.clientId ? { clientId: opts.clientId } : {}),
          ...(opts.clientSecret ? { clientSecret: opts.clientSecret } : {}),
          ...(opts.scopes ? { scopes: opts.scopes } : {}),
          ...(opts.port ? { port: opts.port } : {}),
        });
        process.stdout.write(
          JSON.stringify(
            {
              ok: true,
              storedAt: oauthFilePath(),
              scope: state.scope,
              expiresAt: new Date(state.expiresAt).toISOString(),
            },
            null,
            2,
          ) + "\n",
        );
      },
    );

  program
    .command("logout")
    .description("Forget stored OAuth tokens")
    .action(() => {
      oauthLogout();
      process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    });

  program
    .command("whoami")
    .description("Show stored OAuth state (without exposing the access/refresh tokens)")
    .action(async () => {
      const state = loadOAuthState();
      if (!state) {
        process.stderr.write(JSON.stringify({ error: "Not logged in" }) + "\n");
        process.exit(1);
      }
      const fresh = await refreshIfNeeded(state);
      process.stdout.write(
        JSON.stringify(
          {
            clientId: fresh.clientId,
            scope: fresh.scope,
            expiresAt: new Date(fresh.expiresAt).toISOString(),
            storedAt: oauthFilePath(),
          },
          null,
          2,
        ) + "\n",
      );
    });
}
