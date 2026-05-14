import { NextResponse } from "next/server";

import {
  getActiveTraceId,
  propagateAttributes,
  startActiveObservation,
} from "@langfuse/tracing";

import {
  runDadSupportAgent,
  type ChatTurn,
} from "@/lib/dad-support-agent";
import {
  ensureLangfuseInstrumentation,
  getLangfuseSpanProcessor,
} from "@/lib/langfuse";
import packageJson from "@/package.json";

type ChatRequestBody = {
  message?: string;
  history?: ChatTurn[];
  sessionId?: string;
  userId?: string;
};

export async function POST(request: Request) {
  await ensureLangfuseInstrumentation();

  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const message = body.message?.trim();
  const userId = body.userId?.trim() || process.env.DAD_DEFAULT_USER_ID || "dad";
  const sessionId = body.sessionId?.trim() || crypto.randomUUID();
  const history = Array.isArray(body.history)
    ? body.history.filter(
        (turn): turn is ChatTurn =>
          Boolean(turn) &&
          (turn.role === "user" || turn.role === "assistant") &&
          typeof turn.content === "string",
      )
    : [];

  if (!message) {
    return NextResponse.json(
      { error: "A message is required." },
      { status: 400 },
    );
  }

  let traceId: string | null = null;

  const response = await startActiveObservation("dad-chat-request", async (span) => {
    traceId = getActiveTraceId() ?? null;

    span.update({
      input: {
        message,
        historyLength: history.length,
      },
      metadata: {
        route: "/api/chat",
        appVersion: packageJson.version,
      },
    });

    return await propagateAttributes(
      {
        userId,
        sessionId,
        traceName: "dad-chat-request",
        version: packageJson.version,
        tags: ["dad-tech-support", "chat"],
        metadata: {
          feature: "dad-tech-support-agent",
          phoneHelperMode: "dad-self-serve",
        },
      },
      async () => {
        const agentResponse = await runDadSupportAgent({
          message,
          history,
          userId,
        });

        span.update({
          output: {
            anthropicMessageId: agentResponse.anthropicMessageId,
            mode: agentResponse.mode,
            answerPreview: agentResponse.answer.slice(0, 240),
          },
        });

        return agentResponse;
      },
    );
  });

  await getLangfuseSpanProcessor()?.forceFlush();

  return NextResponse.json({
    ...response,
    sessionId,
    traceId,
  });
}
