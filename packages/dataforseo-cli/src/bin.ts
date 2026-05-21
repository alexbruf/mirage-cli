import { buildProgram } from "./dfs.ts";

buildProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({ error: message }) + "\n");
    process.exit(1);
  });
