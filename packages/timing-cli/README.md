# Timing CLI

A fast, standalone CLI for the [Timing](https://timingapp.com) time-tracking API. Built with Bun and compiled to a single binary — no runtime needed.

Includes a **Claude Code skill** so Claude can manage your time tracking directly.

## Install

### Download a prebuilt binary

Grab the latest release for your platform from [Releases](https://github.com/alexbruf/timing-api/releases/latest):

| Platform     | Binary                |
| ------------ | --------------------- |
| macOS ARM64  | `timing-darwin-arm64` |
| macOS x64    | `timing-darwin-amd64` |
| Linux x64    | `timing-linux-amd64`  |
| Linux ARM64  | `timing-linux-arm64`  |

```bash
# Example: macOS ARM64
curl -L https://github.com/alexbruf/timing-api/releases/latest/download/timing-darwin-arm64 -o timing
chmod +x timing
sudo mv timing /usr/local/bin/
```

### Build from source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/alexbruf/timing-api.git
cd timing-api
bun install
bun run build
# Binary is at ./timing
```

## Setup

1. Get an API token from the [Timing web app](https://web.timingapp.com) → API Keys
2. Set the environment variable:

```bash
export TIMING_API_TOKEN="your_token_here"
```

3. Verify it works:

```bash
timing projects list --format table
```

## Usage

```
timing [--format json|table] [--timezone <tz>] <command>
```

### Timer

```bash
timing start --project <id> --title "Working on feature"
timing stop
timing running
timing latest
```

### Projects

```bash
timing projects list [--hide-archived] [--all-pages]
timing projects hierarchy
timing projects get <id>
timing projects create --title "New Project" [--color "#FF0000"]
timing projects update <id> --title "Renamed"
timing projects delete <id>
```

### Time Entries

```bash
timing entries list --from 2025-01-01 --to 2025-01-31 [--project <ref>] [--all-pages]
timing entries get <id>
timing entries create --start "2025-01-01T09:00:00Z" --end "2025-01-01T17:00:00Z" --title "Work"
timing entries update <id> --title "Updated"
timing entries delete <id>
timing entries batch-update --ids 123 456 --billing billable
```

### Reports

```bash
timing report --from 2025-01-01 --to 2025-01-31
timing report --from 2025-01-01 --to 2025-01-31 --group-by project --timespan week
```

### Teams

```bash
timing teams list
timing teams members <teamId>
```

### Activities

```bash
timing activities --start 2025-01-01 --end 2025-01-02
```

## Claude Code Skill

The included skill lets Claude manage your time tracking directly from Claude Code.

### Install the skill

1. Make sure the `timing` binary is on your `PATH` (see [Install](#install) above)

2. Add the skill to your Claude Code project or global config:

```bash
# From this repo (if cloned)
claude skill add ./skill/SKILL.md

# Or add it globally so it's available in every project
claude skill add --global ./skill/SKILL.md
```

3. Make sure `TIMING_API_TOKEN` is set in your shell environment (Claude Code inherits it)

### What you can ask Claude

Once installed, just talk to Claude naturally:

- "Start tracking time on the Acme project"
- "What am I working on right now?"
- "Stop the timer"
- "What did I work on today?"
- "How much time did I spend on the documentation project this week?"
- "Create a new project called Research"
- "Show me a report for last month grouped by project"

Claude will use the `timing` CLI behind the scenes and present results in a readable format.

## Output Formats

- **JSON** (default) — machine-readable, ideal for piping and scripting
- **Table** (`--format table`) — human-readable ASCII tables

```bash
# JSON (default)
timing projects list

# Table
timing projects list --format table
```

## License

MIT
