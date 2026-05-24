# ics-cli

A fast CLI tool for reading ICS (iCalendar) feeds from URLs or local files. Outputs events as plain text tables or JSON. Built with Bun and compiled to a standalone binary — no runtime required.

Designed for both human use and AI agent consumption (includes a Claude Code skill definition).

## Installation

### From GitHub Releases

Download the pre-built binary for your platform from [Releases](../../releases), then:

```bash
chmod +x ics-cli-*
mv ics-cli-* /usr/local/bin/ics-cli
```

### From Source

```bash
bun install
bun run build  # produces ./ics-cli binary
```

## Quick Start

```bash
# Save a calendar
ics-cli add work "https://calendar.google.com/calendar/ical/YOUR_CALENDAR/basic.ics"

# View today's schedule
ics-cli today

# Get this week's events as JSON (for scripts/AI)
ics-cli week --json

# Next 5 upcoming events
ics-cli next

# Query a date range
ics-cli events --from 2026-03-01 --to 2026-03-31
```

## Commands

| Command | Description |
|---|---|
| `ics-cli add <name> <url>` | Save a calendar URL with a name |
| `ics-cli list [--json]` | List saved calendars |
| `ics-cli remove <name>` | Remove a saved calendar |
| `ics-cli today [--json]` | Today's events |
| `ics-cli week [--json]` | This week's events (Mon–Sun) |
| `ics-cli next [-n N] [--json]` | Next N upcoming events (default 5) |
| `ics-cli events [options]` | Query events with filters |

### Event Query Options

All event commands (`events`, `today`, `week`, `next`) support:

- `-c, --calendar <name>` — Query a specific saved calendar
- `-u, --url <url>` — Query an ad-hoc ICS URL (not saved)
- `--json` — Output as JSON array
- `-n, --limit <n>` — Limit number of results

The `events` command additionally supports:

- `--from <YYYY-MM-DD>` — Start date filter
- `--to <YYYY-MM-DD>` — End date filter

If no `-c` or `-u` is specified, all saved calendars are queried.

## JSON Output

With `--json`, events are output as an array of objects:

```json
[
  {
    "summary": "Team Standup",
    "start": "2026-03-01T14:00:00.000Z",
    "end": "2026-03-01T14:15:00.000Z",
    "location": "",
    "description": "",
    "uid": "abc123@google.com",
    "allDay": false,
    "calendar": "work"
  }
]
```

All-day events use date-only format for `start`/`end` (e.g., `"2026-03-01"`).

## Config

Calendars are stored in `~/.config/ics-cli/config.json`. No credentials or API keys are required — ICS feed URLs contain their own authentication tokens.

## Claude Code Skill

The `claude-skill/SKILL.md` file can be used as a Claude Code skill to let Claude query your calendar. Copy it to your skills directory to enable natural language calendar queries.

## License

MIT
