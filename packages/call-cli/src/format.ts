import chalk from "chalk";
import type { CallState } from "./shared/types.ts";

export function error(msg: string): void {
  console.error(chalk.red(`Error: ${msg}`));
}

export function success(msg: string): void {
  console.log(chalk.green(msg));
}

export function info(msg: string): void {
  console.log(chalk.cyan(msg));
}

const statusColors: Record<string, (s: string) => string> = {
  initiating: chalk.yellow,
  ringing: chalk.yellow,
  playing: chalk.blue,
  completed: chalk.green,
  failed: chalk.red,
};

export function formatCallState(call: CallState): string {
  const colorFn = statusColors[call.status] ?? chalk.white;
  const lines = [
    `${chalk.bold("Call")} ${chalk.dim(call.id)}`,
    `  Phone:   ${call.phone}`,
    `  Status:  ${colorFn(call.status)}`,
    `  Audio:   ${call.audio_id}`,
    `  Started: ${call.created_at}`,
  ];
  if (call.completed_at) {
    lines.push(`  Ended:   ${call.completed_at}`);
  }
  if (call.error) {
    lines.push(`  Error:   ${chalk.red(call.error)}`);
  }
  return lines.join("\n");
}
