import { ApiError } from "./client.ts";
import { buildProgram } from "./cli.ts";

buildProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const details =
      error instanceof ApiError
        ? {
            status: error.status,
            error_type: error.errorType,
            retry_after: error.retryAfter,
          }
        : {};
    process.stderr.write(`${JSON.stringify({ error: message, ...details })}\n`);
    process.exit(1);
  });
