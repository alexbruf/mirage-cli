import {
  command,
  CommandSpec,
  IOResult,
  Option,
  OperandKind,
  type CommandDef,
} from "../framework/index.ts";
import { flagBool, flagStr } from "../framework/output.ts";
import { configPath, loadCredentials, saveCredentials } from "../lib/auth.ts";
import { get } from "../lib/client.ts";

const RESOURCE = "ram";
const ENC = new TextEncoder();

export const loginCmd: CommandDef = command({
  name: "login",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Save DataForSEO credentials to ~/.config/dataforseo/config.json (chmod 600).",
    options: [
      new Option({ short: "l", long: "login", valueKind: OperandKind.TEXT, description: "API login (email).", required: true }),
      new Option({ short: "p", long: "password", valueKind: OperandKind.TEXT, description: "API password.", required: true }),
      new Option({ long: "no-verify", valueKind: OperandKind.NONE, description: "Skip the verification call." }),
    ],
  }),
  fn: async (_acc, _paths, _texts, opts) => {
    const login = flagStr(opts, "login");
    const password = flagStr(opts, "password");
    if (!flagBool(opts, "no-verify")) {
      process.env.DATAFORSEO_LOGIN = login;
      process.env.DATAFORSEO_PASSWORD = password;
      try {
        await get("/v3/appendix/user_data");
      } catch (err) {
        return [
          null,
          new IOResult({
            exitCode: 1,
            stderr: `Credentials rejected: ${(err as Error).message}\nRun with --no-verify to save anyway.\n`,
          }),
        ];
      }
    }
    const path = saveCredentials({ login, password });
    return [ENC.encode(`Saved credentials to ${path}\n`), new IOResult()];
  },
});

export const whoamiCmd: CommandDef = command({
  name: "whoami",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Show the configured login (and verify against DataForSEO).",
  }),
  fn: async () => {
    const creds = loadCredentials();
    let out = `login: ${creds.login}\nconfig: ${configPath()}\n`;
    const resp = await get("/v3/appendix/user_data");
    const user = (resp.tasks?.[0]?.result as Array<{ money?: { balance?: number } }> | undefined)?.[0];
    if (user?.money?.balance !== undefined) out += `balance: $${user.money.balance.toFixed(2)}\n`;
    return [ENC.encode(out), new IOResult()];
  },
});
