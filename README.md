# Dad Tech Support

![Dad Support agent UI](./screenshot.png)

A small Next.js assistant for patient phone-help conversations. It can reply through the browser UI or through Twilio WhatsApp, uses a saved user profile for context, can trace requests in Langfuse, and supports a `code red` prompt override for broader assistance.

If `ANTHROPIC_API_KEY` is missing, the app still runs in fallback mode so the UI and webhook can be tested without live model credentials.

## Docs

- [architecture.md](./architecture.md) — system overview, component map, deployment shape, and design choices
- [AGENT.md](./AGENT.md) — Codex/operator runbook with human-in-the-loop auth boundaries
- [render.yaml](/Users/annabellschafer/dad-supportapp-whatsapp/dad_support_agent/render.yaml) — optional Render deployment blueprint

## Quick start

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

The app reads configuration from `.env` or `.env.local`.

### Core

| Variable | Required | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | for live mode | Without it, the app returns fallback replies |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-4-5` |
| `DAD_DEFAULT_USER_ID` | no | Defaults to `dad` |

### WhatsApp and persistence

| Variable | Required | Notes |
| --- | --- | --- |
| `TWILIO_AUTH_TOKEN` | for WhatsApp | Validates inbound Twilio signatures |
| `TWILIO_WEBHOOK_URL` | recommended in production | Exact public webhook URL, for example `https://your-domain/api/whatsapp` |
| `REDIS_URL` | optional | Generic Redis URL for WhatsApp session memory |
| `UPSTASH_REDIS_REST_URL` | optional | Upstash REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | optional | Upstash REST token |
| `WHATSAPP_ENABLE_WEB_SEARCH` | no | Defaults to `false` for hosted WhatsApp flows |
| `WHATSAPP_MAX_TOKENS` | no | Defaults to `450` |
| `WHATSAPP_SESSION_TTL_SECONDS` | no | Defaults to `86400` |
| `WHATSAPP_ANTHROPIC_MODEL` | no | Optional WhatsApp-specific model override |

### Langfuse

| Variable | Required | Notes |
| --- | --- | --- |
| `LANGFUSE_PUBLIC_KEY` | for tracing | All three Langfuse vars must be set together |
| `LANGFUSE_SECRET_KEY` | for tracing | |
| `LANGFUSE_BASE_URL` | for tracing | `https://cloud.langfuse.com` or `https://us.cloud.langfuse.com` |
| `LANGFUSE_PROMPT_CACHE_TTL_MS` | no | Prompt cache TTL, defaults to `30000` |
| `LANGFUSE_TRACING_ENVIRONMENT` | no | Example: `development` or `production` |
| `LANGFUSE_RELEASE` | no | Release label for traces |

Tracing only turns on when all three base Langfuse credentials are present.

## Twilio WhatsApp

The repo exposes a Twilio-compatible webhook at `POST /api/whatsapp`.

### Fastest test path: Twilio Sandbox

1. Run the app locally with `npm run dev`.
2. Expose port `3000` with a public tunnel such as `ngrok` or Cloudflare Tunnel.
3. In Twilio Console, open `Messaging > Try it out > Send a WhatsApp message > Sandbox settings`.
4. Set **When a message comes in** to `https://your-public-url/api/whatsapp`.
5. Keep the method as `POST`.
6. From the target phone, send the current sandbox join phrase shown in Twilio Console.
7. Send a normal WhatsApp message and confirm the assistant replies.

Notes:

- Sandbox access is available immediately after the phone sends the join phrase.
- Sandbox membership lasts 3 days, then the phone must rejoin.
- Sandbox is for testing only.

### Matching incoming phone numbers to profiles

If you want a specific WhatsApp number to map to a saved profile, add `phoneNumbers` to that profile in `data/user-profiles.json`:

```json
[
  {
    "id": "dad",
    "name": "Dad",
    "phoneNumbers": ["+491234567890"]
  }
]
```

## Deployment

### Recommended path

Use **Vercel + Upstash Redis**.

Why:

- easiest Next.js hosting path
- public HTTPS by default
- simple environment-variable setup
- easy Redis-backed WhatsApp memory

### Production checklist

1. Push the repo to GitHub.
2. Import it into Vercel.
3. Add the core environment variables.
4. Set `TWILIO_WEBHOOK_URL` to `https://your-domain/api/whatsapp`.
5. Attach Upstash Redis through the Vercel integration.
6. Redeploy once after Redis is attached.
7. Point Twilio Sandbox or your production sender to the same webhook URL.

### Verify production

Open:

```text
https://your-domain/api/health
```

Expected:

- `"ok": true`
- `sessionStore.backend` is `"redis"` if persistence is configured

Then send a WhatsApp message and a follow-up message to confirm context persists.

## Langfuse

If Langfuse is configured, the app will:

- trace `/api/chat` and `/api/whatsapp`
- record a separate generation span with full input and output
- fetch prompts from Langfuse Prompt Management when available

To sync the local prompt definitions into Langfuse:

```bash
npm run langfuse:sync-prompts
```

## Current limits

- WhatsApp currently handles text messages only
- browser chat history is only in the current browser session
- durable WhatsApp context requires Redis or Upstash
- Twilio Sandbox is a test path, not a production sender
