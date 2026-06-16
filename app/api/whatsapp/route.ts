import {
  getActiveTraceId,
  propagateAttributes,
  startActiveObservation,
} from "@langfuse/tracing";

import { runDadSupportAgent } from "@/lib/dad-support-agent";
import {
  ensureLangfuseInstrumentation,
  getLangfuseSpanProcessor,
} from "@/lib/langfuse";
import { getUserProfileByPhoneNumber } from "@/lib/profiles";
import {
  buildTwilioMessagingResponse,
  getTwilioWebhookParams,
  isValidTwilioWebhookRequest,
} from "@/lib/twilio-whatsapp";
import { appendWhatsAppExchange, getWhatsAppHistory } from "@/lib/whatsapp-sessions";
import packageJson from "@/package.json";

export const runtime = "nodejs";

function createXmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}

function createWhatsAppReply(message: string, status = 200) {
  return createXmlResponse(buildTwilioMessagingResponse(message), status);
}

export async function GET() {
  return new Response(
    "Twilio WhatsApp webhook is ready. Point your incoming-message webhook to POST /api/whatsapp.",
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

export async function POST(request: Request) {
  await ensureLangfuseInstrumentation();

  const formData = await request.formData();
  const params = getTwilioWebhookParams(formData);
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;

  if (
    twilioAuthToken &&
    !isValidTwilioWebhookRequest(request, params, twilioAuthToken)
  ) {
    return new Response("Invalid Twilio signature.", { status: 403 });
  }

  const inboundMessage = params.Body?.trim();

  if (!inboundMessage) {
    return createWhatsAppReply(
      "Send me a phone question and I’ll text back with the steps.",
    );
  }

  const senderId = params.WaId?.trim() || params.From?.trim() || "unknown";
  const sessionId = `whatsapp:${senderId}`;
  const matchedProfile =
    (params.WaId && (await getUserProfileByPhoneNumber(params.WaId))) ||
    (params.From && (await getUserProfileByPhoneNumber(params.From))) ||
    null;
  const userId = matchedProfile?.id || process.env.DAD_DEFAULT_USER_ID || "dad";
  const history = await getWhatsAppHistory(sessionId);

  let traceId: string | null = null;

  try {
    const agentResponse = await startActiveObservation(
      "whatsapp-inbound-request",
      async (span) => {
        traceId = getActiveTraceId() ?? null;

        span.update({
          input: {
            body: inboundMessage,
            from: params.From ?? null,
            profileName: params.ProfileName ?? null,
          },
          metadata: {
            route: "/api/whatsapp",
            channel: "whatsapp",
            appVersion: packageJson.version,
            messageSid: params.MessageSid ?? null,
            from: params.From ?? null,
            to: params.To ?? null,
            waId: params.WaId ?? null,
            profileName: params.ProfileName ?? null,
          },
        });

        return await propagateAttributes(
          {
            userId,
            sessionId,
            traceName: "whatsapp-inbound-request",
            version: packageJson.version,
            tags: ["dad-tech-support", "whatsapp"],
            metadata: {
              feature: "dad-support-whatsapp",
              channel: "whatsapp",
              from: params.From ?? null,
              waId: params.WaId ?? null,
            },
          },
          async () => {
            const response = await runDadSupportAgent({
              channel: "whatsapp",
              message: inboundMessage,
              history,
              userId,
            });

            span.update({
              output: {
                answerPreview: response.answer.slice(0, 240),
                mode: response.mode,
                anthropicMessageId: response.anthropicMessageId,
                matchedProfileId: matchedProfile?.id ?? null,
                traceId,
              },
            });

            return response;
          },
        );
      },
    );

    await appendWhatsAppExchange(sessionId, inboundMessage, agentResponse.answer);

    await getLangfuseSpanProcessor()?.forceFlush();

    return createWhatsAppReply(agentResponse.answer);
  } catch {
    await getLangfuseSpanProcessor()?.forceFlush();

    return createWhatsAppReply(
      "Something went wrong on my side. Send that again in a moment and I’ll try again.",
    );
  }
}
