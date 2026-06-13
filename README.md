# Dad Tech Support

![Dad Support agent UI](./screenshot.png)

A tiny Next.js chatbot that helps a non-technical user with phone questions. The agent loads a saved user profile (phone model, OS, carrier, tone preferences), then calls the Anthropic Messages API with web search enabled. It can answer either through the browser UI or through an inbound Twilio WhatsApp webhook. Each request is traced end-to-end in Langfuse, and the system prompt can be managed in Langfuse Prompt Management instead of staying hardcoded in app code. If a message starts with `code red`, the app switches to a broader general-assistant prompt for that turn.

If `ANTHROPIC_API_KEY` is missing the app still runs — it returns a placeholder reply so the UI is browseable without credentials.

## Requirements

- Node.js 20 or newer
- An Anthropic API key (optional — fallback mode works without one)
- A Langfuse project (optional — tracing only)

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Then open http://localhost:3000.

To test WhatsApp locally, expose your app with a public tunnel such as `ngrok` and point Twilio's incoming-message webhook at `https://your-public-url/api/whatsapp`.

## Environment variables

All variables live in `.env`. The app reads them on boot.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | for live mode | Without this the app runs in fallback mode |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-4-5` |
| `DAD_DEFAULT_USER_ID` | no | Profile id to load from `data/user-profiles.json` (default `dad`) |
| `TWILIO_AUTH_TOKEN` | for secure WhatsApp webhooks | Validates `X-Twilio-Signature` on incoming Twilio requests |
| `LANGFUSE_PUBLIC_KEY` | for tracing | All three Langfuse vars must be set together |
| `LANGFUSE_SECRET_KEY` | for tracing | |
| `LANGFUSE_BASE_URL` | for tracing | `https://cloud.langfuse.com` (EU) or `https://us.cloud.langfuse.com` (US) |
| `LANGFUSE_PROMPT_CACHE_TTL_MS` | no | How long the runtime keeps a fetched Langfuse prompt in memory before checking again (default `30000`) |
| `LANGFUSE_TRACING_ENVIRONMENT` | no | Tags traces, e.g. `development`, `production` |
| `LANGFUSE_RELEASE` | no | Release label for traces |

Tracing only initialises if **all three** of `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` are set. Otherwise the app runs normally with no Langfuse calls.

## WhatsApp with Twilio

This repo now includes a Twilio-compatible webhook at `POST /api/whatsapp`.

### What you need from Twilio

- A Twilio account that has been upgraded from trial if you want a production sender
- A WhatsApp sender:
  - For testing: the Twilio Sandbox for WhatsApp
  - For production: a WhatsApp sender registered in Twilio Console
- Your `TWILIO_AUTH_TOKEN` so the webhook can validate Twilio signatures
- A public HTTPS URL that Twilio can reach, such as an `ngrok` tunnel in development or your deployed app URL in production

### If you want to use your own phone number

Twilio's WhatsApp self sign-up flow supports either a Twilio phone number or a non-Twilio phone number. The number must not already be registered with WhatsApp, and if it's non-Twilio it must be able to receive an SMS or voice OTP during registration.

For a production sender you also need admin access to your Meta Business Portfolio / WhatsApp Business Account setup, and you'll need to complete Meta business verification before moving fully into production.

### Twilio Console setup

#### Fastest test path: Sandbox

1. Run the app with `npm run dev`.
2. Start a public tunnel to port 3000, for example `ngrok http 3000`.
3. In Twilio Console, open the WhatsApp Sandbox settings.
4. In the **When a message comes in** field, set your webhook URL to `https://your-public-url/api/whatsapp`.
5. Join the sandbox from your WhatsApp account, then send a test message.

#### Production path: real sender

1. In Twilio Console, go to `Messaging > Senders > WhatsApp Senders`.
2. Create a new sender and complete the WhatsApp self sign-up flow.
3. Register either a Twilio number or your own compatible number.
4. Configure the sender's incoming-message webhook to `https://your-domain/api/whatsapp`.
5. Add `TWILIO_AUTH_TOKEN` to your runtime environment before going live.

### Matching a WhatsApp sender to a saved profile

The webhook tries to match an incoming WhatsApp number to a saved profile before falling back to `DAD_DEFAULT_USER_ID`. To opt in, add `phoneNumbers` to a profile in `data/user-profiles.json`:

```json
[
  {
    "id": "dad",
    "name": "Dad",
    "phoneNumbers": ["+491234567890"]
  }
]
```

The number can be stored either as `+491234567890` or in Twilio's `whatsapp:+491234567890` style; the server normalizes both.

### Current behavior and limits

- The webhook returns TwiML directly, so Twilio sends the assistant's reply back in the same inbound request cycle.
- Short conversation history is stored in memory per WhatsApp sender so brief back-and-forth works during a running process.
- In-memory history is fine for a first version, but for production-grade continuity across deploys or multiple servers you should move that history to Redis, Postgres, or another shared store.
- Media attachments are not handled yet; this route currently answers text messages only.

## How tracing is wired

### Setup chain

1. **`instrumentation.ts`** — the Next.js [instrumentation hook](https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation). Next calls `register()` once at boot, only on the Node runtime (OTEL `NodeSDK` won't run on edge).
2. **`lib/langfuse.ts`** — `ensureLangfuseInstrumentation()` starts an OpenTelemetry `NodeSDK` with:
   - `LangfuseSpanProcessor` from `@langfuse/otel` — exports spans to your Langfuse project
   - `AnthropicInstrumentation` from `@arizeai/openinference-instrumentation-anthropic` — optionally adds low-level Anthropic spans when available
   - Init is idempotent and skipped entirely if any of the three Langfuse env vars are missing.
3. **`lib/langfuse-prompts.ts`** — fetches the production system prompt from Langfuse Prompt Management, caches it briefly in memory, and falls back to the local prompt definition if Langfuse is unavailable or the prompt has not been created yet. It supports both the default `dad-support/system` prompt and the `dad-support/code-red` override prompt.
4. **`app/api/chat/route.ts`, `app/api/whatsapp/route.ts`, and `lib/dad-support-agent.ts`** — add the app-level observations using `@langfuse/tracing`, including a first-class `generation` span that stores the compiled system prompt, the full request messages, the final reply, and token usage.

This matches the [official Langfuse Anthropic JS/TS integration](https://langfuse.com/integrations/model-providers/anthropic-js).

### Trace structure (per chat turn)

```
dad-chat-request or whatsapp-inbound-request        (span)        ← route.ts, with userId/sessionId/tags
├── lookup-user-profile                             (tool)        ← profile read from data/user-profiles.json
└── generate-dad-answer                             (agent)       ← parent for the model call
    ├── dad-support-generation                      (generation)  ← locked prompt + input + output + usage
    └── web-search × N                              (tool)        ← one per server-side web_search invocation
```

What you get on each span:

| Span | Type | Captures |
| --- | --- | --- |
| `dad-chat-request` | span | User message, `userId`, `sessionId`, tags (`dad-tech-support`, `chat`), app version, final answer preview |
| `whatsapp-inbound-request` | span | Incoming WhatsApp body, sender/recipient ids, message SID, matched profile, final answer preview |
| `lookup-user-profile` | tool | `userId` in, profile fields out (phone model, OS, carrier) |
| `generate-dad-answer` | agent | Model name, transport, linked prompt reference, answer preview, anthropic message id, `webSearchCount` |
| `dad-support-generation` | generation | Full compiled system prompt, full Anthropic message payload, final reply, token usage, linked Langfuse prompt version, raw content blocks, and appended source links |
| `web-search` | tool | The exact query Claude ran, result count, and `[ { url, title, pageAge } ]`. Errors (`max_uses_exceeded`, `unavailable`, etc.) are emitted as `ERROR`-level spans with the Anthropic error code as `statusMessage`. |

### Langfuse Prompt Management

The system prompts are defined locally in `lib/langfuse-prompts.json` and are meant to live in Langfuse under these prompt names:

- `dad-support/system` — the normal phone-help assistant
- `dad-support/code-red` — a broader override prompt used when a message starts with `code red`

- Fetch behavior: runtime always asks Langfuse for the `production` version first, then falls back to the local prompt definition if the prompt is missing or Langfuse is unavailable.
- Variable: the prompt uses `{{userId}}`, which is compiled per request before the Anthropic call.
- Prompt linkage: the `dad-support-generation` span stores the Langfuse prompt name and version, so the generation links back to the exact prompt revision in the Langfuse UI.
- Trigger behavior: `code red` only switches the app-level prompt. It does not disable higher-priority model safety rules.

To bootstrap or refresh the prompt from the repo into Langfuse, run this with your Langfuse environment loaded:

```bash
npm run langfuse:sync-prompts
```

After that, edit the prompt in Langfuse UI and keep the `production` label on the version you want the app to use.

### Why the manual `web-search` spans exist

`web_search` is a **server-side** Anthropic tool: the model runs the searches inside Anthropic's infrastructure and returns the results inline in the same response. From the client's perspective there is only one SDK call, so the auto-instrumentation produces only one span. The search queries and result URLs are still in that span's response payload — but they aren't filterable or aggregatable across traces.

`lib/dad-support-agent.ts` walks `response.content` after the call, pairs each `server_tool_use` (`name: "web_search"`) with its matching `web_search_tool_result`, and emits one `web-search` observation per invocation. That gives you:

- A filterable span name in Langfuse (`name = web-search`)
- A per-trace `webSearchCount` to slice on
- Per-search input/output so you can audit what the model is actually retrieving

If you add other server-side tools later (`web_fetch`, `code_execution`, etc.), follow the same pattern — auto-instrumentation will not split them out for you.

### Trace-level attributes (propagated to all spans)

Set in `app/api/chat/route.ts` and `app/api/whatsapp/route.ts` via `propagateAttributes`:

- `userId` — from request body or `DAD_DEFAULT_USER_ID`
- `sessionId` — from request body or a fresh UUID per request
- `tags` — `["dad-tech-support", "chat"]`
- `version` — from `package.json`
- `metadata.feature` — `dad-tech-support-agent`

WhatsApp requests use the same shape, but with `tags = ["dad-tech-support", "whatsapp"]` and channel metadata attached.

A `forceFlush()` runs after each request so traces appear in Langfuse without waiting for the OTEL batch interval — important because Next.js route handlers are short-lived.

### Verifying it works

1. Set all three `LANGFUSE_*` vars in `.env`.
2. Run `npm run dev` and send a chat message that prompts a web search (e.g. *"How do I change text size on my phone?"*).
3. Open your Langfuse project → Traces. You should see a `dad-chat-request` trace with the structure above, including one or more `web-search` child spans.

If traces don't appear, set `LANGFUSE_LOG_LEVEL=DEBUG` and check the dev server logs.

## Customising the user profile

Edit `data/user-profiles.json`. Each entry needs an `id`, plus phone/carrier fields the system prompt uses. The default `DAD_DEFAULT_USER_ID=dad` matches the seeded profile.

## Project layout

```
app/
  page.tsx              Chat UI
  layout.tsx            Root layout
  globals.css           Styles
  api/chat/             POST /api/chat — calls the agent
  api/whatsapp/         POST /api/whatsapp — Twilio WhatsApp webhook
data/
  user-profiles.json    Seeded profiles
lib/
  dad-support-agent.ts  Agent: profile lookup + Anthropic call, traced
  langfuse.ts           OTEL + Langfuse setup
  profiles.ts           Profile loader
  twilio-whatsapp.ts    Twilio webhook validation + TwiML response helpers
  whatsapp-sessions.ts  Lightweight in-memory WhatsApp history
instrumentation.ts      Next.js boot hook → starts Langfuse
```

## Scripts

- `npm run dev` — Next dev server
- `npm run build` — production build
- `npm run langfuse:sync-prompts` — create a new Langfuse prompt version from `lib/langfuse-prompts.json`
- `npm run start` — run the production build
- `npm run typecheck` — TypeScript check, no emit
