# Agent Runbook

This file is for Codex or another coding agent that should deploy this repo and wire it to Twilio WhatsApp with minimal back-and-forth.

## Human-in-the-loop boundaries

The agent should automate the setup, but all authentication and secret ownership stays with the human.

Human responsibilities:

- create and own the Anthropic, Twilio, Langfuse, GitHub, and Vercel accounts
- log into GitHub, Vercel, and Twilio in the in-app browser when needed
- obtain API keys, tokens, and other credentials from the original providers
- place secrets in `.env.local`, `.env`, or the hosting provider's secret UI
- approve any billing, upgrade, sender registration, or account-verification actions

Agent responsibilities:

- read already-present local configuration
- wire environment variables into the app or hosting settings once they already exist
- configure deploy settings, webhook URLs, and non-secret runtime values
- verify health endpoints, persistence, and end-to-end behavior

The agent must not:

- ask the user to paste raw secrets into the chat unless there is no safer option
- invent, rotate, or regenerate credentials on the user's behalf
- complete third-party login flows without the user's active authenticated session
- commit secrets, local auth files, or machine-specific marketplace caches

## Goal

Set up this app so:

- the Next.js site is deployed
- `POST /api/whatsapp` is publicly reachable
- Twilio WhatsApp Sandbox points to that webhook
- WhatsApp follow-up context persists across messages
- optional Langfuse tracing stays enabled

## Default choices

Use these defaults unless the user explicitly asks for something else:

- Hosting: Vercel
- Persistence: Upstash Redis via the Vercel integration
- WhatsApp sender: Twilio Sandbox first, real sender later
- `WHATSAPP_ENABLE_WEB_SEARCH=false`
- `WHATSAPP_MAX_TOKENS=450`
- `WHATSAPP_SESSION_TTL_SECONDS=86400`
- `LANGFUSE_TRACING_ENVIRONMENT=production` in hosted environments

## Required inputs

The agent should look for these locally before asking the user:

- `.env.local` or `.env` with:
  - `ANTHROPIC_API_KEY`
  - `TWILIO_AUTH_TOKEN`
  - optional Langfuse keys
- a GitHub repo already connected to the project

The agent only needs to ask the user for help when:

- the user is not logged into Vercel in the in-app browser
- the user is not logged into Twilio in the in-app browser
- the required secrets have not yet been placed locally by the user
- secrets are missing locally

If secrets are missing, the agent should ask the human to add them locally rather than requesting the secret values inline in chat.

## Local verification steps

1. Inspect the repo and confirm the WhatsApp route exists at `app/api/whatsapp/route.ts`.
2. Confirm session storage support exists in `lib/whatsapp-sessions.ts`.
3. Install dependencies if needed.
4. Run:

```bash
npm run typecheck
npm run build
```

5. If code changes were required, commit them before deployment.

## Vercel deployment steps

1. Open Vercel in the in-app browser.
2. Import the GitHub repository as a new Next.js project.
3. Add environment variables from local secrets:
   - `ANTHROPIC_API_KEY`
   - `ANTHROPIC_MODEL`
   - `DAD_DEFAULT_USER_ID`
   - `TWILIO_AUTH_TOKEN`
   - `LANGFUSE_PUBLIC_KEY`
   - `LANGFUSE_SECRET_KEY`
   - `LANGFUSE_BASE_URL`
   - `LANGFUSE_TRACING_ENVIRONMENT=production`
   - `LANGFUSE_RELEASE=dad-tech-support@0.1.0`
   - `WHATSAPP_ENABLE_WEB_SEARCH=false`
   - `WHATSAPP_MAX_TOKENS=450`
   - `WHATSAPP_SESSION_TTL_SECONDS=86400`

Only copy these values from local files or from the provider UI while the human is logged in. Do not ask the user to paste the secrets into the conversation if local/provider access is available.

4. Complete the first deploy.
5. Once the production domain is known, set:

```text
TWILIO_WEBHOOK_URL=https://<your-domain>/api/whatsapp
```

6. Install the Upstash integration from Vercel Marketplace.
7. Create or connect a free Redis database.
8. Let Vercel attach the Redis credentials automatically.
9. Redeploy production once after Redis is attached.

## Production verification

After the redeploy, open:

```text
https://<your-domain>/api/health
```

Expected result:

```json
{
  "ok": true,
  "sessionStore": {
    "backend": "redis",
    "configuredRedisUrl": true
  }
}
```

If the health endpoint still reports `"backend": "memory"`, redeploy again and verify the Redis env vars are actually attached to the Vercel project.

## Twilio Sandbox setup steps

The agent should use the in-app browser and navigate to:

1. `Twilio Console`
2. `Messaging`
3. `Try it out`
4. `Send a WhatsApp message`
5. `Sandbox settings`

Then set:

- `When a message comes in` = `https://<your-domain>/api/whatsapp`
- `Method` = `POST`

Save the form, reload the page, reopen `Sandbox settings`, and confirm the value persisted.

If Twilio is not logged in, stop at the login page and ask the human to sign in before continuing.

## User handoff after sandbox setup

Tell the user:

- send the current join phrase shown in Twilio Console to the sandbox number
- sandbox membership lasts 3 days
- after joining, send a test message and then a follow-up message
- if the app replies and remembers context, the setup is complete

## Important notes

- Twilio Sandbox is for testing only.
- The sandbox number is shared; the join phrase is the important account-specific part.
- Do not commit `.env`, `.env.local`, `.codex/langfuse.json`, or marketplace cache files.
- If browser automation cannot finish because the user is logged out, stop exactly at the login page and ask the user to sign in.
- If provider UIs require human approval for billing, sender registration, or business verification, pause there and hand control back to the human.
- Prefer a PR-based git flow if direct pushes are blocked.

## Fast checklist

- Build passes
- Vercel deploys
- Upstash attached
- Production redeployed after Redis attach
- `/api/health` reports Redis
- Twilio Sandbox inbound webhook points to production URL
- User joined sandbox
- End-to-end WhatsApp reply works
