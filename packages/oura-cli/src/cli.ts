/**
 * Oura CLI as a commander.js program. `buildProgram()` is idempotent and has
 * no side effects on import (no `.parseAsync()` at module top-level).
 *
 * Data subcommands hit api.ouraring.com directly via fetch — workerd-safe.
 * The interactive auth subcommands (`setup`, `login`, `logout`) touch
 * `node:fs` / `node:http` and only work on Node/Bun.
 */
import { Command } from "commander";
import { createServer } from "node:http";
import {
  CALLBACK_PORT,
  CONFIG_DIR,
  OAUTH_AUTHORIZE_URL,
  OAUTH_SCOPES,
  OAUTH_TOKEN_URL,
  type StoredTokens,
  deleteTokens,
  getOAuthCredentials,
  getToken,
  loadConfig,
  saveConfig,
  saveTokens,
} from "./auth.ts";
import {
  formatDailyActivity,
  formatDailyCardiovascularAge,
  formatDailyReadiness,
  formatDailyResilience,
  formatDailySleep,
  formatDailySpo2,
  formatDailyStress,
  formatEnhancedTag,
  formatHeartRate,
  formatList,
  formatPersonalInfo,
  formatRestMode,
  formatRingConfig,
  formatSession,
  formatSleep,
  formatSleepTime,
  formatVo2Max,
  formatWorkout,
} from "./format.ts";

const API_BASE = "https://api.ouraring.com/v2/usercollection";

interface DateOpts {
  startDate?: string;
  endDate?: string;
  startDatetime?: string;
  endDatetime?: string;
  nextToken?: string;
  json?: boolean;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function apiGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const url = new URL(API_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  const token = await getToken();
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Oura API ${res.status}: ${body}`);
  }
  return res.json();
}

function attachDateOpts(cmd: Command): Command {
  return cmd
    .option("--start-date <date>", "start date YYYY-MM-DD (default: 7 days ago)")
    .option("--end-date <date>", "end date YYYY-MM-DD (default: today)")
    .option("--next-token <token>", "pagination token from a previous response")
    .option("--json", "emit raw JSON instead of formatted text");
}

function attachDatetimeOpts(cmd: Command): Command {
  return cmd
    .option("--start-datetime <iso>", "start datetime YYYY-MM-DDTHH:MM:SS")
    .option("--end-datetime <iso>", "end datetime YYYY-MM-DDTHH:MM:SS")
    .option("--next-token <token>", "pagination token")
    .option("--json", "emit raw JSON instead of formatted text");
}

function dateParams(o: DateOpts): Record<string, string> {
  const params: Record<string, string> = {};
  params.start_date = o.startDate ?? daysAgo(7);
  params.end_date = o.endDate ?? todayStr();
  if (o.nextToken) params.next_token = o.nextToken;
  return params;
}

function datetimeParams(o: DateOpts): Record<string, string> {
  const params: Record<string, string> = {};
  params.start_datetime = o.startDatetime ?? daysAgo(1) + "T00:00:00";
  params.end_datetime = o.endDatetime ?? todayStr() + "T23:59:59";
  if (o.nextToken) params.next_token = o.nextToken;
  return params;
}

function emit(data: any, o: DateOpts, fmt: (data: any) => string): void {
  if (o.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }
  process.stdout.write(fmt(data) + "\n");
}

function attachListCommand(
  program: Command,
  name: string,
  description: string,
  endpoint: string,
  itemFormatter: (items: any[]) => string,
): void {
  const cmd = program.command(name).description(description);
  attachDateOpts(cmd);
  cmd.action(async (o: DateOpts) => {
    const data = await apiGet(endpoint, dateParams(o));
    emit(data, o, (d) => formatList(d, itemFormatter));
  });
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("oura")
    .description("Oura Ring API v2 CLI — sleep, activity, readiness, HRV, SpO2, workouts")
    .version("0.1.6");

  // ── Data (read-only) ───────────────────────────────────────────────
  program
    .command("personal-info")
    .description("get your personal info (age, weight, height, sex, email)")
    .option("--json", "emit raw JSON")
    .action(async (o: DateOpts) => {
      const data = await apiGet("/personal_info", {});
      emit(data, o, formatPersonalInfo);
    });

  attachListCommand(program, "daily-activity", "daily activity scores, calories, steps, movement", "/daily_activity", formatDailyActivity);
  attachListCommand(program, "daily-readiness", "daily readiness scores + contributors", "/daily_readiness", formatDailyReadiness);
  attachListCommand(program, "daily-sleep", "daily sleep scores + contributors", "/daily_sleep", formatDailySleep);
  attachListCommand(program, "sleep", "detailed sleep periods (durations, HR, HRV, stages)", "/sleep", formatSleep);
  attachListCommand(program, "daily-spo2", "daily blood oxygen (SpO2) averages", "/daily_spo2", formatDailySpo2);
  attachListCommand(program, "daily-stress", "daily stress and recovery minutes", "/daily_stress", formatDailyStress);

  const hr = program
    .command("heart-rate")
    .description("5-minute interval heart rate readings");
  attachDatetimeOpts(hr);
  hr.action(async (o: DateOpts) => {
    const data = await apiGet("/heartrate", datetimeParams(o));
    emit(data, o, (d) => formatList(d, formatHeartRate));
  });

  attachListCommand(program, "workout", "workout data (type, duration, calories, distance)", "/workout", formatWorkout);
  attachListCommand(program, "session", "guided/unguided session data with biometrics", "/session", formatSession);
  attachListCommand(program, "enhanced-tag", "lifestyle tags with timestamps and comments", "/enhanced_tag", formatEnhancedTag);
  attachListCommand(program, "ring-config", "ring configuration (model, size, firmware, color)", "/ring_configuration", formatRingConfig);
  attachListCommand(program, "rest-mode", "rest mode periods", "/rest_mode_period", formatRestMode);
  attachListCommand(program, "sleep-time", "optimal bedtime recommendations", "/sleep_time", formatSleepTime);
  attachListCommand(program, "cardiovascular-age", "daily cardiovascular age estimate", "/daily_cardiovascular_age", formatDailyCardiovascularAge);
  attachListCommand(program, "daily-resilience", "daily resilience level and contributor scores", "/daily_resilience", formatDailyResilience);
  attachListCommand(program, "vo2-max", "estimated VO2 max values", "/vO2_max", formatVo2Max);

  // ── Auth (Node/Bun only) ───────────────────────────────────────────
  program
    .command("setup")
    .description("configure authentication (interactive, Node/Bun only)")
    .action(async () => {
      await runSetup();
    });

  program
    .command("login")
    .description("authenticate via OAuth2 (opens browser, Node/Bun only)")
    .action(async () => {
      await runLogin();
    });

  program
    .command("logout")
    .description("remove stored OAuth2 tokens")
    .action(() => {
      deleteTokens();
      process.stdout.write("Logged out. Stored tokens deleted.\n");
    });

  program
    .command("config-path")
    .description("print the config directory path")
    .action(() => {
      process.stdout.write(CONFIG_DIR + "\n");
    });

  return program;
}

// ── Interactive helpers (only used by `setup` / `login`) ─────────────

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const onData = (chunk: Buffer) => {
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      resolve(chunk.toString("utf8").trim());
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function runSetup(): Promise<void> {
  process.stdout.write("oura setup — configure authentication\n\n");
  process.stdout.write("  1) Personal Access Token (paste a token)\n");
  process.stdout.write("  2) OAuth2 (client ID + secret, opens browser to log in)\n\n");

  const choice = await prompt("Auth method [1/2]: ");

  if (choice === "1") {
    const token = await prompt("Personal Access Token: ");
    if (!token) throw new Error("No token provided.");
    saveConfig({ auth_method: "pat", access_token: token });
    process.stdout.write(`\nConfig saved to ${CONFIG_DIR}/config.json\n`);
    process.stdout.write("You're all set — try 'oura personal-info'.\n");
    return;
  }
  if (choice === "2") {
    process.stdout.write("\nRegister an app at https://cloud.ouraring.com/oauth/applications\n");
    process.stdout.write("Set the redirect URI to: http://localhost:" + CALLBACK_PORT + "/callback\n\n");
    const clientId = await prompt("Client ID: ");
    const clientSecret = await prompt("Client Secret: ");
    if (!clientId || !clientSecret) throw new Error("Both client ID and secret are required.");
    saveConfig({ auth_method: "oauth2", client_id: clientId, client_secret: clientSecret });
    process.stdout.write(`\nConfig saved to ${CONFIG_DIR}/config.json\n`);

    const loginNow = await prompt("Log in now? [Y/n]: ");
    if (!loginNow || loginNow.toLowerCase().startsWith("y")) {
      await runLogin();
    } else {
      process.stdout.write("Run 'oura login' when you're ready to authenticate.\n");
    }
    return;
  }
  throw new Error("Invalid choice. Run 'oura setup' again.");
}

async function runLogin(): Promise<void> {
  const { clientId, clientSecret } = getOAuthCredentials();
  const redirectUri = `http://localhost:${CALLBACK_PORT}/callback`;
  const authUrl = new URL(OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", OAUTH_SCOPES);

  process.stdout.write("Opening browser for Oura OAuth2 login...\n");
  process.stdout.write(`If the browser doesn't open, visit:\n  ${authUrl.toString()}\n\n`);

  const { spawn } = await import("node:child_process");
  const openCmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(openCmd, [authUrl.toString()], { stdio: "ignore" });

  const code = await waitForCallbackCode();
  if (!code) throw new Error("Authorization was denied or failed.");

  const tokenRes = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
  }
  const data = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const stored: StoredTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  saveTokens(stored);
  process.stdout.write("Logged in successfully! Tokens saved.\n");
}

function waitForCallbackCode(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" }).end(
          "<html><body><h2>Authorization denied.</h2><p>You can close this tab.</p></body></html>",
        );
        server.close();
        resolve("");
        return;
      }
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" }).end(
          "<html><body><h2>Success!</h2><p>You can close this tab.</p></body></html>",
        );
        server.close();
        resolve(code);
        return;
      }
      res.writeHead(400).end("Missing code");
    });
    server.listen(CALLBACK_PORT, () => {
      process.stdout.write(`Waiting for authorization callback on port ${CALLBACK_PORT}...\n`);
    });
  });
}

// loadConfig is re-exported for downstream wrappers; reference it so the
// import isn't tree-shaken when the wrapper deep-imports from this module.
export { loadConfig };
