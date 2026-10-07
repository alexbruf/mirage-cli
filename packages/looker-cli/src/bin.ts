import { buildProgram } from "./cli.ts";

buildProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(JSON.stringify({ error: message }) + "\n");
    process.exit(1);
  });
