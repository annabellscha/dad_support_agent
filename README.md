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

### Setup chain

1. **`instrumentation.ts`** — the Next.js [instrumentation hook](https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation). Next calls `register()` once at boot, only on the Node runtime (OTEL `NodeSDK` won't run on edge).
2. **`lib/langfuse.ts`** — `ensureLangfuseInstrumentation()` starts an OpenTelemetry `NodeSDK` with:
   - `LangfuseSpanProcessor` from `@langfuse/otel` — exports spans to your Langfuse project
   - `AnthropicInstrumentation` from `@arizeai/openinference-instrumentation-anthropic` — auto-wraps the Anthropic SDK
   - Init is idempotent and skipped entirely if any of the three Langfuse env vars are missing.
3. **`app/api/chat/route.ts` and `lib/dad-support-agent.ts`** — add manual spans on top of the auto-instrumentation using `@langfuse/tracing`.

This matches the [official Langfuse Anthropic JS/TS integration](https://langfuse.com/integrations/model-providers/anthropic-js).

### Trace structure (per chat turn)

```
dad-chat-request                       (span)        ← route.ts, with userId/sessionId/tags
├── lookup-user-profile                (tool)        ← profile read from data/user-profiles.json
└── generate-dad-answer                (agent)       ← parent for the model call
    ├── anthropic.messages.create      (generation)  ← auto-instrumented; full request + response
    └── web-search × N                 (tool)        ← one per server-side web_search invocation
```

What you get on each span:

| Span | Type | Captures |
| --- | --- | --- |
| `dad-chat-request` | span | User message, `userId`, `sessionId`, tags (`dad-tech-support`, `chat`), app version, final answer preview |
| `lookup-user-profile` | tool | `userId` in, profile fields out (phone model, OS, carrier) |
| `generate-dad-answer` | agent | Model name, transport, answer preview, anthropic message id, `webSearchCount` |
| `anthropic.messages.create` | generation | Full request (system prompt, messages, tool config) and full response (all content blocks) — auto-captured by OpenInference. Token usage and model name come for free. |
| `web-search` | tool | The exact query Claude ran, result count, and `[ { url, title, pageAge } ]`. Errors (`max_uses_exceeded`, `unavailable`, etc.) are emitted as `ERROR`-level spans with the Anthropic error code as `statusMessage`. |

### Why the manual `web-search` spans exist

`web_search` is a **server-side** Anthropic tool: the model runs the searches inside Anthropic's infrastructure and returns the results inline in the same response. From the client's perspective there is only one SDK call, so the auto-instrumentation produces only one span. The search queries and result URLs are still in that span's response payload — but they aren't filterable or aggregatable across traces.

`lib/dad-support-agent.ts` walks `response.content` after the call, pairs each `server_tool_use` (`name: "web_search"`) with its matching `web_search_tool_result`, and emits one `web-search` observation per invocation. That gives you:

- A filterable span name in Langfuse (`name = web-search`)
- A per-trace `webSearchCount` to slice on
- Per-search input/output so you can audit what the model is actually retrieving

If you add other server-side tools later (`web_fetch`, `code_execution`, etc.), follow the same pattern — auto-instrumentation will not split them out for you.

### Trace-level attributes (propagated to all spans)

Set in `app/api/chat/route.ts` via `propagateAttributes`:

- `userId` — from request body or `DAD_DEFAULT_USER_ID`
- `sessionId` — from request body or a fresh UUID per request
- `tags` — `["dad-tech-support", "chat"]`
- `version` — from `package.json`
- `metadata.feature` — `dad-tech-support-agent`

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
