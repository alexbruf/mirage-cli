# @mirage-cli/localfalcon-cli

Local Falcon geo-grid local rank tracking as a Commander CLI. Mirage / Cloudflare-Worker compatible (fetch-only, no `node:fs` or interactive auth).

## Auth
Set `LOCALFALCON_API_KEY` (Local Falcon → Settings → API). The key is sent as the `api_key` form field on every request.

## Commands
- `localfalcon locations [-q <text>] [-n <limit>]` — saved/connected locations.
- `localfalcon reports [-p <place_id>] [-k <keyword>] [-g <grid>] [-s <date>] [-u <date>] [-n <limit>]` — existing scan reports (report_key, ARP/ATRP/SoLV, image URL, date).
- `localfalcon report <report_key>` — one report's full payload (ARP/ATRP/SoLV + image/heatmap/pdf URLs + grid data points).
- `localfalcon keywords [-k <keyword>] [-n <limit>]` — keyword-level rollups (avg ARP/ATRP/SoLV).
- `localfalcon scan -k <keyword> (-p <place_id> | --lat --lng) [-g <grid>] [-r <miles>]` — **runs a new grid scan; billable (consumes scan credits).**
- `localfalcon raw <path> [k=v ...]` — POST any API path.

All commands support `-f, --format table|json|csv`. Every command reads existing data except `scan`, which is billable.

## Metrics
- **ARP** — average rank across pins where you appear.
- **ATRP** — average rank across the whole grid (counts pins where you don't appear).
- **SoLV** — share of grid points where you rank in the top 3.

Docs: https://docs.localfalcon.com/
