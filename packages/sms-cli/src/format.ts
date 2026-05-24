import chalk from "chalk";
import type { Message, Conversation, Contact } from "./shared/types.ts";

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function dirArrow(direction: "in" | "out"): string {
  return direction === "in" ? chalk.blue("←") : chalk.green("→");
}

export function unreadDot(read: boolean): string {
  return read ? " " : chalk.yellow("●");
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

export function formatMessageRow(
  msg: Message,
  contactName?: string | null,
): string {
  const dot = unreadDot(msg.read);
  const id = chalk.dim(shortId(msg.id));
  const arrow = dirArrow(msg.direction);
  const phone = contactName || msg.phone_number;
  const time = formatTime(msg.timestamp);
  const text = truncate(msg.text.replace(/\n/g, " "), 50);
  return `${dot} ${id}   ${arrow} ${phone.padEnd(16)} ${time.padEnd(10)} ${text}`;
}

export function formatMessageList(msgs: Message[]): string {
  if (msgs.length === 0) return chalk.dim("No messages.");
  return msgs.map((m) => formatMessageRow(m)).join("\n");
}

export function formatConversationList(convos: Conversation[]): string {
  if (convos.length === 0) return chalk.dim("No conversations.");
  return convos
    .map((c) => {
      const unread =
        c.unread_count > 0 ? chalk.yellow(`(${c.unread_count})`) : "";
      const name = c.name || c.phone_number;
      const phone = c.name ? chalk.dim(` ${c.phone_number}`) : "";
      const time = formatTime(c.last_message_at);
      const text = truncate(c.last_message.replace(/\n/g, " "), 40);
      return `${unread.padEnd(6)} ${name}${phone}  ${chalk.dim(time)}  ${text}`;
    })
    .join("\n");
}

export function formatThread(
  msgs: Message[],
  phone: string,
  contactName?: string | null,
): string {
  const header = contactName
    ? `Conversation with ${phone} (${contactName})`
    : `Conversation with ${phone}`;
  const separator = "─".repeat(Math.max(header.length, 40));
  const lines = [chalk.bold(header), separator, ""];
  for (const msg of msgs) {
    const arrow = dirArrow(msg.direction);
    const time = new Date(msg.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push(`${arrow} ${chalk.dim(`[${time}]`)}`);
    lines.push(`  ${msg.text}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function formatMessageDetail(
  msg: Message,
  contactName?: string | null,
): string {
  const name = contactName ? ` (${contactName})` : "";
  return [
    `${chalk.bold("ID:")}        ${msg.id}`,
    `${chalk.bold("Phone:")}     ${msg.phone_number}${name}`,
    `${chalk.bold("Direction:")} ${msg.direction === "in" ? "Incoming" : "Outgoing"}`,
    `${chalk.bold("Time:")}      ${new Date(msg.timestamp).toLocaleString()}`,
    `${chalk.bold("SIM:")}       ${msg.sim_number}`,
    `${chalk.bold("Read:")}      ${msg.read ? "Yes" : "No"}`,
    "─".repeat(40),
    msg.text,
  ].join("\n");
}

export function formatContactList(contacts: Contact[]): string {
  if (contacts.length === 0) return chalk.dim("No contacts.");
  return contacts
    .map((c) => `${c.name.padEnd(20)} ${chalk.dim(c.phone_number)}`)
    .join("\n");
}

export function error(msg: string): void {
  console.error(chalk.red(`Error: ${msg}`));
}

export function success(msg: string): void {
  console.log(chalk.green(msg));
}
