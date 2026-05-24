import type { OutputFormat } from "./types.ts";

export function output(data: unknown, format: OutputFormat, tableFormatter?: () => string): void {
  if (format === "table" && tableFormatter) {
    console.log(tableFormatter());
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

export function outputMessage(msg: string, format: OutputFormat): void {
  if (format === "table") {
    console.log(msg);
  } else {
    console.log(JSON.stringify({ message: msg }));
  }
}

export function outputError(msg: string, format: OutputFormat): void {
  if (format === "table") {
    console.error(`Error: ${msg}`);
  } else {
    console.error(JSON.stringify({ error: msg }));
  }
  process.exit(1);
}
