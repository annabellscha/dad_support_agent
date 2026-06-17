# Configuration Reference

This file contains the detailed environment variable reference for the Dad Tech Support app.

The app reads configuration from `.env` or `.env.local`.

## Core

| Variable | Required | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | for live mode | Without it, the app returns fallback replies |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-4-5` |
| `DAD_DEFAULT_USER_ID` | no | Defaults to `dad` |

## WhatsApp and persistence

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

## Langfuse

| Variable | Required | Notes |
| --- | --- | --- |
| `LANGFUSE_PUBLIC_KEY` | for tracing | All three base Langfuse vars must be set together |
| `LANGFUSE_SECRET_KEY` | for tracing | |
| `LANGFUSE_BASE_URL` | for tracing | `https://cloud.langfuse.com` or `https://us.cloud.langfuse.com` |
| `LANGFUSE_PROMPT_CACHE_TTL_MS` | no | Prompt cache TTL, defaults to `30000` |
| `LANGFUSE_TRACING_ENVIRONMENT` | no | Example: `development` or `production` |
| `LANGFUSE_RELEASE` | no | Release label for traces |

Tracing only turns on when all three base Langfuse credentials are present.
