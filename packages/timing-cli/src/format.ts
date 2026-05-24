import type { TimingProject, TimingEntry, TimingTeam, TimingTeamMember, ReportEntry } from "./types.ts";

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+/, "").slice(0, 19);
}

function extractId(self: string): string {
  const parts = self.split("/");
  return parts[parts.length - 1] ?? self;
}

function line(widths: number[]): string {
  return widths.map((w) => "-".repeat(w + 2)).join("+");
}

function row(cells: string[], widths: number[]): string {
  return cells.map((c, i) => " " + pad(c, widths[i] ?? 0) + " ").join("|");
}

function table(headers: string[], rows: string[][], widths: number[]): string {
  const lines: string[] = [];
  lines.push(row(headers, widths));
  lines.push(line(widths));
  for (const r of rows) {
    lines.push(row(r, widths));
  }
  return lines.join("\n");
}

export function formatProjects(projects: TimingProject[]): string {
  const widths = [6, 30, 8, 7];
  const rows = projects.map((p) => [
    extractId(p.self),
    p.title,
    p.is_archived ? "yes" : "no",
    p.color,
  ]);
  return table(["ID", "Title", "Archived", "Color"], rows, widths);
}

export function formatProject(p: TimingProject): string {
  const lines = [
    `ID:       ${extractId(p.self)}`,
    `Title:    ${p.title_chain.join(" → ")}`,
    `Color:    ${p.color}`,
    `Archived: ${p.is_archived ? "yes" : "no"}`,
  ];
  if (p.notes) lines.push(`Notes:    ${p.notes}`);
  if (p.default_billing_rate != null) lines.push(`Rate:     $${p.default_billing_rate}/hr`);
  if (p.default_billing_status) lines.push(`Billing:  ${p.default_billing_status}`);
  if (p.parent) lines.push(`Parent:   ${extractId(p.parent.self)}`);
  if (Object.keys(p.custom_fields).length > 0) {
    lines.push(`Custom:   ${JSON.stringify(p.custom_fields)}`);
  }
  return lines.join("\n");
}

export function formatEntries(entries: TimingEntry[]): string {
  const widths = [6, 25, 19, 19, 8, 12];
  const rows = entries.map((e) => [
    extractId(e.self),
    e.title || "(untitled)",
    formatDate(e.start_date),
    e.is_running ? "running" : formatDate(e.end_date),
    formatDuration(e.duration),
    e.billing_status,
  ]);
  return table(["ID", "Title", "Start", "End", "Duration", "Billing"], rows, widths);
}

export function formatEntry(e: TimingEntry): string {
  const lines = [
    `ID:       ${extractId(e.self)}`,
    `Title:    ${e.title || "(untitled)"}`,
    `Start:    ${formatDate(e.start_date)}`,
    `End:      ${e.is_running ? "running" : formatDate(e.end_date)}`,
    `Duration: ${formatDuration(e.duration)}`,
    `Billing:  ${e.billing_status}`,
  ];
  if (e.notes) lines.push(`Notes:    ${e.notes}`);
  if (e.project) lines.push(`Project:  ${e.project.title || extractId(e.project.self)}`);
  if (e.billing_rate != null) lines.push(`Rate:     $${e.billing_rate}/hr`);
  if (e.billing_amount != null) lines.push(`Amount:   $${e.billing_amount}`);
  if (Object.keys(e.custom_fields).length > 0) {
    lines.push(`Custom:   ${JSON.stringify(e.custom_fields)}`);
  }
  return lines.join("\n");
}

export function formatTeams(teams: TimingTeam[]): string {
  const widths = [6, 30];
  const rows = teams.map((t) => [extractId(t.self), t.name]);
  return table(["ID", "Name"], rows, widths);
}

export function formatTeamMembers(members: TimingTeamMember[]): string {
  const widths = [6, 30, 10];
  const rows = members.map((m) => [extractId(m.self), m.email, m.role]);
  return table(["ID", "Email", "Role"], rows, widths);
}

export function formatReport(entries: ReportEntry[], depth = 0): string {
  const lines: string[] = [];
  for (const e of entries) {
    const indent = "  ".repeat(depth);
    const title = e.title || (e.project ? extractId(e.project.self) : "(no project)");
    const billing = e.billing_amount != null ? `  $${e.billing_amount}` : "";
    lines.push(`${indent}${title}: ${formatDuration(e.duration)} (${e.time_entries} entries)${billing}`);
    if (e.children) {
      lines.push(formatReport(e.children, depth + 1));
    }
  }
  return lines.join("\n");
}

export function formatRunning(e: TimingEntry): string {
  const lines = [
    `Timer is running:`,
    `  Title:    ${e.title || "(untitled)"}`,
    `  Started:  ${formatDate(e.start_date)}`,
    `  Duration: ${formatDuration(e.duration)}`,
  ];
  if (e.project) lines.push(`  Project:  ${e.project.title || extractId(e.project.self)}`);
  return lines.join("\n");
}
