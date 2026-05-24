# SMS CLI

Stateful SMS management system wrapping [SMS Gateway for Android](https://sms-gate.app/). Two components:

- **sms-server** — Hono HTTP server + SQLite. Receives webhooks, stores messages, exposes REST API.
- **sms** — CLI client (himalaya-inspired UX). Talks to sms-server.

Two gateway modes:

- **Proxy mode** (default) — Forwards SMS through an existing SMS Gateway server (Go or cloud).
- **Private mode** — Your sms-server *is* the gateway. The Android app connects directly to it. No Go server needed.

```
Proxy mode:
┌─────────┐     ┌─────────────┐     ┌──────────────┐     ┌───────────┐
│ sms CLI │────>│ sms-server  │────>│ SMS Gateway  │────>│  Android  │
│         │     │ (Hono+SQLite│     │ server (Go)  │     │  phone    │
└─────────┘     └─────────────┘     └──────────────┘     └───────────┘

Private mode:
┌─────────┐     ┌─────────────┐                          ┌───────────┐
│ sms CLI │────>│ sms-server  │<─────────────────────────>│  Android  │
│         │     │ (Hono+SQLite│  direct (mobile API +     │  phone    │
└─────────┘     └─────────────┘   push via FCM relay)     └───────────┘
```

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+ installed on your computer/server
- An Android phone with a SIM card
- **SMS Gateway for Android** app installed ([GitHub releases](https://github.com/capcom6/android-sms-gateway/releases) or app store)

### Install

```bash
git clone <this-repo> && cd sms-cli
bun install
cp .env.example .env
```

Now choose your setup mode:

---

## Setup A: Private Mode (recommended)

Your sms-server acts as the gateway. The Android app connects directly — no external Go server needed. Push notifications are relayed through `api.sms-gate.app` (FCM) so the phone wakes up even when the app is backgrounded.

### Step 1: Configure .env

```bash
GATEWAY_MODE=private
PRIVATE_TOKEN=pick-a-strong-secret-here
PUBLIC_URL=https://your-server.com    # URL reachable from the Android phone
SMS_DB_PATH=~/.sms-inbox/messages.db
SMS_SERVER_PORT=5555
SMS_SERVER_URL=http://127.0.0.1:5555
```

`PUBLIC_URL` must be reachable from your phone. Options:
- **Same network:** `http://<your-computer-ip>:5555`
- **Remote:** Use a tunnel (ngrok, Cloudflare Tunnel) or deploy to a VPS with HTTPS

### Step 2: Start the server

```bash
bun run dev:server
# => Gateway mode: private
# => Webhook signing: enabled (auto-generated key: ...)
# => sms-server listening on http://localhost:5555
```

### Step 3: Connect the Android app

1. Open SMS Gateway for Android
2. Toggle **"Private Server"** on
3. Enter your server URL: `https://your-server.com` (your `PUBLIC_URL`)
4. Enter your private token (your `PRIVATE_TOKEN`)
5. Tap **"Offline"** → **"Online"**

The app will register itself with your server. You'll see a login/password pair — these are for 3rd-party API access (the CLI doesn't need them).

### Step 4: Use the CLI

```bash
# Check for messages
bun run dev:cli

# Send a message (enqueued to the phone)
bun run dev:cli -- send +15551234567 "Hello from private mode!"

# List messages
bun run dev:cli -- list
```

When you send a message, the server notifies the phone via FCM push. The phone picks up the pending message, sends it as SMS, and reports back the delivery status.

Incoming SMS are forwarded to your server automatically via the self-registering webhook.

### Security notes

- Use **HTTPS** for `PUBLIC_URL` in production (the private token and messages travel over this connection)
- Webhook payloads from the Android app are HMAC-SHA256 signed (key auto-generated and given to the device via settings)
- `PRIVATE_TOKEN` is only used during device registration, not for ongoing communication
- Set `WEBHOOK_SIGNING_KEY` in `.env` to persist the signing key across restarts

---

## Setup B: Proxy Mode

Forwards SMS through an external SMS Gateway server (the Go server running on LAN, or the cloud service at `api.sms-gate.app`). This is the original mode.

### Step 1: Set up SMS Gateway on the phone

**Option A: Local Server (same network)**

1. Toggle **"Local Server"** on in the Android app
2. Tap **"Offline"** → **"Online"**
3. Note the **IP address**, **username**, and **password**

**Option B: Cloud Server (anywhere)**

1. Toggle **"Cloud Server"** on
2. Tap **"Offline"** → **"Online"**
3. Note the **username** and **password**

### Step 2: Configure .env

```bash
GATEWAY_MODE=proxy
ASG_ENDPOINT=http://192.168.1.100:8080      # or https://api.sms-gate.app/3rdparty/v1
ASG_USERNAME=your-username
ASG_PASSWORD=your-password
SMS_DB_PATH=~/.sms-inbox/messages.db
SMS_SERVER_PORT=5555
SMS_SERVER_URL=http://127.0.0.1:5555
```

### Step 3: Start the server

```bash
bun run dev:server
# => Gateway mode: proxy
# => sms-server listening on http://localhost:5555
```

### Step 4: Register a webhook (receive incoming SMS)

This tells SMS Gateway to forward incoming messages to your server.

**Local Server:**
```bash
curl -X POST -u <username>:<password> \
  -H "Content-Type: application/json" \
  -d '{"url": "http://<your-computer-ip>:5555/webhook", "event": "sms:received"}' \
  http://<phone-ip>:8080/webhooks
```

**Cloud Server** (sms-server must be publicly accessible):
```bash
curl -X POST -u <username>:<password> \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-public-url/webhook", "event": "sms:received"}' \
  https://api.sms-gate.app/3rdparty/v1/webhooks
```

### Step 5: Use the CLI

```bash
bun run dev:cli -- list
bun run dev:cli -- send +15551234567 "Hello!"
bun run dev:cli -- read +15551234567
```

---

## CLI Commands

```
sms                           # show unread count (default)
sms list [-u|--unread] [-s|--sent] [-a|--all] [-n LIMIT]
sms conversations|conv        # list threads with unread counts
sms read <phone|id>           # view conversation or message, marks read
sms send <phone> [message]    # send (message from args or stdin)
sms reply <phone> [message]   # send with context of last message shown
sms mark-read <id>...
sms mark-unread <id>...
sms delete <id>... [-f|--force]
sms search <query>
sms contact --add <phone> <name>
sms contact --list
sms contact --delete <phone>
sms config [key] [value]          # get/set config (e.g. server_url)
```

### Output examples

**List view:**
```
● abc123de   ← +15551234567    10:30      Hey are you free tomorrow?
  def456ab   → +15559876543    Yesterday  Meeting confirmed
  ghi789cd   ← +15551234567    Jan 15     Thanks for the info
```
- `●` = unread
- `←` = incoming, `→` = outgoing
- Short IDs (first 8 chars, prefix-matchable)

**Conversation view:**
```
Conversation with +15551234567 (John Doe)
──────────────────────────────────────────
← [10:30]
  Hey are you free tomorrow?

→ [10:32]
  Yeah, what's up?

← [10:33]
  Want to grab lunch?
```

### Tips

- **Pipe messages from stdin:** `echo "Hello" | sms send +15551234567`
- **Prefix matching:** `sms read abc` matches message ID `abc123de...`
- **Auto-mark-read:** `sms read` marks messages/conversations as read automatically. Use `--no-mark` to prevent this.
- **SIM selection:** `sms send +1555... "Hi" --sim 2` to use SIM slot 2

---

## Server API

Core endpoints (both modes):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Status + unread count |
| GET | `/messages?direction=in&unread=true&phone=+1&limit=50&offset=0` | List messages |
| GET | `/messages/:id` | Get message (supports prefix matching) |
| POST | `/messages/:id/read` | Mark read |
| POST | `/messages/:id/unread` | Mark unread |
| DELETE | `/messages/:id` | Delete message |
| POST | `/send` | Send SMS: `{"phone": "+1...", "text": "...", "sim": 1}` |
| GET | `/conversations` | List threads with unread counts |
| GET | `/conversations/:phone` | Get thread |
| POST | `/conversations/:phone/read` | Mark entire thread read |
| GET | `/contacts` | List contacts |
| POST | `/contacts` | Add: `{"phone": "+1...", "name": "..."}` |
| DELETE | `/contacts/:phone` | Remove contact |
| GET | `/search?q=query` | Full-text search |
| POST | `/webhook` | Receives SMS Gateway webhooks |

### Private mode additional endpoints

**Mobile API** (used by the Android app — Bearer token auth):

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/mobile/v1/device` | Register device (requires `PRIVATE_TOKEN`) |
| GET | `/api/mobile/v1/device` | Get device info |
| PATCH | `/api/mobile/v1/device` | Update push token / name |
| GET | `/api/mobile/v1/message` | Poll pending outgoing messages |
| PATCH | `/api/mobile/v1/message` | Report delivery status |
| GET | `/api/mobile/v1/events` | SSE stream for real-time notifications |
| GET | `/api/mobile/v1/webhooks` | Get webhook configs |
| GET | `/api/mobile/v1/settings` | Get device settings |

**3rd-party API** (Basic Auth — login/password from device registration):

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/3rdparty/v1/messages` | Enqueue message for sending |
| GET | `/3rdparty/v1/messages` | List gateway messages |
| GET | `/3rdparty/v1/messages/:id` | Get message state + recipients |
| GET | `/3rdparty/v1/devices` | List registered devices |
| DELETE | `/3rdparty/v1/devices/:id` | Remove a device |
| GET | `/3rdparty/v1/webhooks` | List webhooks |
| POST | `/3rdparty/v1/webhooks` | Create webhook |
| DELETE | `/3rdparty/v1/webhooks/:id` | Delete webhook |
| GET | `/3rdparty/v1/health` | Health check |

### Webhook fan-out

When an incoming SMS arrives (via `POST /webhook` from the Android app), the server stores it and then fans out the raw payload to all registered 3rd-party webhooks with event `sms:received`. This lets you build automations — forward incoming texts to Slack, trigger a Zapier workflow, log to a spreadsheet, etc.

Register a webhook via the 3rd-party API:

```bash
curl -X POST -u <login>:<password> \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-endpoint.com/hook", "event": "sms:received"}' \
  https://your-server/3rdparty/v1/webhooks
```

Each registered URL receives a POST with the same `WebhookPayload` body the server received from the Android app:

```json
{
  "event": "sms:received",
  "payload": {
    "phoneNumber": "+15551234567",
    "message": "Hello!",
    "receivedAt": "2026-02-07T12:00:00Z",
    "simNumber": 1
  }
}
```

Each request includes an `X-Webhook-Signature` header containing an HMAC-SHA256 signature of the JSON body, using the server's `WEBHOOK_SIGNING_KEY`:

```
X-Webhook-Signature: sha256=<hex digest>
```

To verify on the receiving end (Node.js example):

```js
import { createHmac } from "crypto";

function verify(body, signature, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  return expected === signature;
}
```

Webhook deliveries are fire-and-forget — failures are silently ignored and not retried.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GATEWAY_MODE` | `proxy` or `private` | `proxy` |
| `ASG_ENDPOINT` | SMS Gateway API URL (proxy mode) | (required in proxy mode) |
| `ASG_USERNAME` | SMS Gateway username (proxy mode) | |
| `ASG_PASSWORD` | SMS Gateway password (proxy mode) | |
| `PRIVATE_TOKEN` | Device registration secret (private mode) | (required in private mode) |
| `PUBLIC_URL` | Server URL reachable from phone (private mode) | (required in private mode) |
| `WEBHOOK_SIGNING_KEY` | HMAC key for webhook verification (private mode) | (auto-generated) |
| `SMS_DB_PATH` | SQLite database path | `~/.sms-inbox/messages.db` |
| `SMS_SERVER_PORT` | Server listen port | `5555` |
| `SMS_SERVER_URL` | Server URL (for CLI, overrides config file) | `http://127.0.0.1:5555` |

---

## Cloudflare Workers Deployment

Instead of running sms-server locally, you can deploy it as a Cloudflare Worker with D1 (serverless SQLite). This eliminates the need for a local server and tunneling.

```bash
cd worker
cp .dev.vars.example .dev.vars   # edit with your secrets
bun install

# Create D1 database and apply migrations
wrangler d1 create sms-server
# Copy the database_id into wrangler.jsonc

wrangler d1 migrations apply sms-server --remote

# Set secrets
wrangler secret put PRIVATE_TOKEN
wrangler secret put PUBLIC_URL
wrangler secret put WEBHOOK_SIGNING_KEY

# Deploy
wrangler deploy
```

Then point the CLI at your Worker URL:

```bash
sms config server_url https://your-worker.your-domain.com
```

## Build standalone binaries

```bash
bun run build
# Produces: ./sms-server and ./sms

# Cross-compile CLI for all platforms:
bun run build:cli
# Produces: sms-darwin-arm64, sms-darwin-x64, sms-linux-x64, sms-linux-arm64

./sms-server &
./sms list
./sms send +15551234567 "Hello!"
```

---

## Troubleshooting

**"Error: ASG_ENDPOINT is required"**
You're in proxy mode but haven't set the endpoint. Either set `ASG_ENDPOINT` or switch to `GATEWAY_MODE=private`.

**"Error: PRIVATE_TOKEN is required in private mode"**
Set `PRIVATE_TOKEN` in your `.env` when using `GATEWAY_MODE=private`.

**"Error: PUBLIC_URL is required in private mode"**
Set `PUBLIC_URL` to your server's address as reachable from the Android phone.

**Server starts but no incoming messages**
- **Proxy mode:** Webhook not registered. See Setup B, Step 4.
- **Private mode:** Make sure the Android app shows "Online" and is connected to your server. The self-referencing webhook is registered automatically.

**"502 Bad Gateway" when sending**
- **Proxy mode:** The sms-server can't reach the SMS Gateway. Check `ASG_ENDPOINT`, username, and password.
- **Private mode:** No device registered. Open the Android app and connect to your server.

**"No registered device" error**
Open the SMS Gateway Android app, go to Private Server settings, enter your `PUBLIC_URL` and `PRIVATE_TOKEN`, and tap Online.

**CLI says "Error: fetch failed"**
The sms-server isn't running. Start it with `bun run dev:server` or `./sms-server`.

**Sent message stays "Pending"**
The phone hasn't picked it up yet. Check that:
1. The Android app is online
2. The phone has cellular service
3. FCM push is working (the app needs Google Play Services for push notifications; without it, the app falls back to SSE polling)
