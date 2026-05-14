# Dad Tech Support

A tiny Next.js chatbot that helps a non-technical user with phone questions. The agent loads a saved user profile (phone model, OS, carrier, tone preferences), then calls the Anthropic Messages API with web search enabled. Each request is traced end-to-end in Langfuse: the chat handler, the profile lookup, and the Claude call.

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

## Environment variables

All variables live in `.env`. The app reads them on boot.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | for live mode | Without this the app runs in fallback mode |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-4-5` |
| `DAD_DEFAULT_USER_ID` | no | Profile id to load from `data/user-profiles.json` (default `dad`) |
| `LANGFUSE_PUBLIC_KEY` | for tracing | All three Langfuse vars must be set together |
| `LANGFUSE_SECRET_KEY` | for tracing | |
| `LANGFUSE_BASE_URL` | for tracing | `https://cloud.langfuse.com` (EU) or `https://us.cloud.langfuse.com` (US) |
| `LANGFUSE_TRACING_ENVIRONMENT` | no | Tags traces, e.g. `development`, `production` |
| `LANGFUSE_RELEASE` | no | Release label for traces |

Tracing only initialises if **all three** of `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` are set. Otherwise the app runs normally with no Langfuse calls.

## How tracing is wired

- `instrumentation.ts` is the Next.js [instrumentation hook](https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation). Next calls it once at boot on the Node runtime.
- It calls `ensureLangfuseInstrumentation()` in `lib/langfuse.ts`, which sets up an OpenTelemetry `NodeSDK` with a `LangfuseSpanProcessor` and the Arize OpenInference auto-instrumentation for the Anthropic SDK.
- `lib/dad-support-agent.ts` wraps the chat turn in `startActiveObservation` spans for the profile lookup and the Claude call. Anthropic SDK calls are auto-instrumented.

To verify tracing works: start the dev server with all Langfuse vars set, send a chat message, then look for a trace in your Langfuse project.

## Customising the user profile

Edit `data/user-profiles.json`. Each entry needs an `id`, plus phone/carrier fields the system prompt uses. The default `DAD_DEFAULT_USER_ID=dad` matches the seeded profile.

## Project layout

```
app/
  page.tsx              Chat UI
  layout.tsx            Root layout
  globals.css           Styles
  api/chat/             POST /api/chat — calls the agent
data/
  user-profiles.json    Seeded profiles
lib/
  dad-support-agent.ts  Agent: profile lookup + Anthropic call, traced
  langfuse.ts           OTEL + Langfuse setup
  profiles.ts           Profile loader
instrumentation.ts      Next.js boot hook → starts Langfuse
```

## Scripts

- `npm run dev` — Next dev server
- `npm run build` — production build
- `npm run start` — run the production build
- `npm run typecheck` — TypeScript check, no emit
