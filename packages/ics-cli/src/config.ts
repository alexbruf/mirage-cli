import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Config } from "./types.ts";

const CONFIG_DIR = join(homedir(), ".config", "ics-cli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

function load(): Config {
  if (!existsSync(CONFIG_FILE)) {
    return { calendars: {} };
  }
  return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
}

function save(data: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2) + "\n");
}

export function addCalendar(name: string, url: string): void {
  const data = load();
  data.calendars[name] = { url, added: new Date().toISOString() };
  save(data);
}

export function removeCalendar(name: string): boolean {
  const data = load();
  if (!(name in data.calendars)) return false;
  delete data.calendars[name];
  save(data);
  return true;
}

export function getCalendar(name: string): { name: string; url: string; added: string } | null {
  const data = load();
  const entry = data.calendars[name];
  if (!entry) return null;
  return { name, ...entry };
}

export function listCalendars(): Array<{ name: string; url: string; added: string }> {
  const data = load();
  return Object.entries(data.calendars).map(([name, entry]) => ({ name, ...entry }));
}

export function getAllCalendarUrls(): Array<[string, string]> {
  const data = load();
  return Object.entries(data.calendars).map(([name, entry]) => [name, entry.url]);
}
