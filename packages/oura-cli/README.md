# oura-cli

A simple CLI for the [Oura Ring API v2](https://cloud.ouraring.com/v2/docs). Built with Bun, compiles to a standalone binary. Designed for AI agents — every command has descriptive output in plain text.

## Quick Start

```bash
bun install
```

### Authentication

```bash
oura setup
```

The interactive setup lets you choose between:
1. **Personal Access Token** — paste your token from [cloud.ouraring.com/personal-access-tokens](https://cloud.ouraring.com/personal-access-tokens)
2. **OAuth2** — register an app at [cloud.ouraring.com/oauth/applications](https://cloud.ouraring.com/oauth/applications), enter your client ID + secret, then authorize in the browser

Config is saved to `~/.config/oura-cli/config.json`. No env vars needed after setup.

### Run

```bash
bun run src/index.ts help
```

## Build Binary

```bash
bun run build
./oura help
```

## Examples

```bash
# Interactive auth setup
oura setup

# Last 7 days of sleep scores
oura daily-sleep

# Specific date range
oura daily-activity --start-date 2025-01-01 --end-date 2025-01-07

# Heart rate (uses datetime)
oura heart-rate --start-datetime 2025-01-15T08:00:00 --end-datetime 2025-01-15T22:00:00

# Personal info
oura personal-info

# Log out (delete stored tokens)
oura logout
```

## Environment

Config is stored at `~/.config/oura-cli/` after running `oura setup`. Env vars are optional overrides:

| Variable | Description |
|---|---|
| `OURA_ACCESS_TOKEN` | Overrides config token if set |
| `OURA_CLIENT_ID` | Overrides config OAuth2 client ID |
| `OURA_CLIENT_SECRET` | Overrides config OAuth2 client secret |
