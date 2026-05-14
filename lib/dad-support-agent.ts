import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  TextBlock,
  WebSearchResultBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";

import { startActiveObservation, startObservation } from "@langfuse/tracing";

import { hasAnthropicAutoInstrumentation } from "@/lib/langfuse";
import { getUserProfile, type UserProfile } from "@/lib/profiles";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type AgentResponse = {
  answer: string;
  anthropicMessageId: string | null;
  mode: "live" | "fallback";
  profile: UserProfile | null;
};

type AgentRequest = {
  message: string;
  history: ChatTurn[];
  userId: string;
};

let anthropicClient: Anthropic | null = null;

function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  return anthropicClient;
}

function buildSystemPrompt(userId: string) {
  return [
    "You are replying directly to Dad as if you are his child helping him over text.",
    "The app already looked up the saved phone profile before you answer.",
    "Only answer questions about his phone, its settings, the mobile carrier, or apps on the phone.",
    "This includes how to use features, where settings are, app capabilities, texting, calling, connectivity, notifications, accessibility, and carrier-related phone tasks.",
    "Do not answer general knowledge, news, politics, coding, shopping, health, legal, finance, or unrelated life questions.",
    "If the question is outside phone settings, carrier help, or app usage, say briefly that you can help only with his phone, carrier, and apps, then ask him to ask a phone-related question.",
    "You are allowed to use WebSearch.",
    "If Dad asks you to look up the manual, official instructions, current app features, current carrier steps, or anything that may have changed, use WebSearch.",
    "Prefer official manufacturer, carrier, and app help pages when using WebSearch.",
    "Never say that you cannot look things up online or cannot check the manual.",
    "Use WebSearch when phone menus, OS settings, app features, manuals, or carrier steps could vary.",
    "Assume Dad is not technical and hates jargon.",
    "Sound warm, familiar, and calm, but do not get cheesy or overly chatty.",
    "Write short numbered steps. Keep each step to one sentence.",
    "It is fine to say Dad once at the start when it sounds natural.",
    "Mention the phone type you are using for the answer when it is helpful.",
    "If you are unsure, ask exactly one short clarifying question.",
    "Avoid risky suggestions like factory resets unless the user explicitly asks for advanced troubleshooting.",
    `The default person to help is userId "${userId}".`,
  ].join(" ");
}

function buildProfileContext(
  profile: UserProfile | null,
) {
  const profileBlock = profile
    ? JSON.stringify(profile, null, 2)
    : "No saved profile was found.";

  return [
    "Phone owner profile lookup result:",
    profileBlock,
  ].join("\n");
}

function buildMessages(
  profile: UserProfile | null,
  history: ChatTurn[],
  message: string,
): MessageParam[] {
  const messages: MessageParam[] = [
    {
      role: "user",
      content: buildProfileContext(profile),
    },
  ];

  for (const turn of history) {
    messages.push({
      role: turn.role,
      content: turn.content,
    });
  }

  messages.push({
    role: "user",
    content: message,
  });

  return messages;
}

function extractAnswerText(
  content: Array<TextBlock | WebSearchResultBlock | Anthropic.Messages.ContentBlock>,
) {
  return content
    .flatMap((block) => {
      if (block.type === "text") {
        return [block.text];
      }

      if (block.type === "web_search_result") {
        return [];
      }

      return [];
    })
    .join("\n")
    .trim();
}

function traceWebSearchInvocations(
  content: Anthropic.Messages.ContentBlock[],
): number {
  const resultsByToolUseId = new Map<
    string,
    Anthropic.Messages.WebSearchToolResultBlock
  >();
  for (const block of content) {
    if (block.type === "web_search_tool_result") {
      resultsByToolUseId.set(block.tool_use_id, block);
    }
  }

  let count = 0;
  for (const block of content) {
    if (block.type !== "server_tool_use" || block.name !== "web_search") {
      continue;
    }

    const query = (block.input as { query?: unknown } | null)?.query;
    const result = resultsByToolUseId.get(block.id);

    const span = startObservation(
      "web-search",
      {
        input: { query: typeof query === "string" ? query : null },
        metadata: { toolUseId: block.id },
      },
      { asType: "tool" },
    );

    if (!result) {
      span.update({ output: { status: "no_result_block" } });
    } else if (Array.isArray(result.content)) {
      span.update({
        output: {
          resultCount: result.content.length,
          results: result.content.map((r) => ({
            url: r.url,
            title: r.title,
            pageAge: r.page_age ?? null,
          })),
        },
      });
    } else {
      span.update({
        level: "ERROR",
        statusMessage: result.content.error_code,
        output: { status: "error", errorCode: result.content.error_code },
      });
    }

    span.end();
    count += 1;
  }

  return count;
}

function buildFallbackAnswer(profile: UserProfile | null, message: string) {
  const deviceLabel = profile
    ? `${profile.phoneModel} (${profile.osFamily} ${profile.osVersion})`
    : "phone";

  return [
    `Dad, I can help with that on your ${deviceLabel}.`,
    "",
    "1. Open the Settings app first.",
    "2. Look for the section that best matches what you want to change.",
    "3. If you tell me exactly what you see on the screen, I can give you the next taps one by one.",
    "",
    `You asked: "${message}"`,
    "",
    "This is fallback mode because the Anthropic API key is not configured yet.",
  ].join("\n");
}

function toLangfuseUsageDetails(
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
) {
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    ...(usage.cache_creation_input_tokens != null
      ? { cache_creation_input_tokens: usage.cache_creation_input_tokens }
      : {}),
    ...(usage.cache_read_input_tokens != null
      ? { cache_read_input_tokens: usage.cache_read_input_tokens }
      : {}),
  };
}

export async function runDadSupportAgent({
  message,
  history,
  userId,
}: AgentRequest): Promise<AgentResponse> {
  const profile = await startActiveObservation(
    "lookup-user-profile",
    async (observation) => {
      const foundProfile = await getUserProfile(userId);

      observation.update({
        input: { userId },
        output: foundProfile
          ? {
              found: true,
              phoneModel: foundProfile.phoneModel,
              osFamily: foundProfile.osFamily,
              osVersion: foundProfile.osVersion,
              carrier: foundProfile.carrier,
            }
          : { found: false },
      });

      return foundProfile;
    },
    { asType: "tool" },
  );

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      answer: buildFallbackAnswer(profile, message),
      anthropicMessageId: null,
      mode: "fallback",
      profile,
    };
  }

  const systemPrompt = buildSystemPrompt(userId);
  const requestMessages = buildMessages(profile, history, message);
  const model =
    process.env.ANTHROPIC_MODEL ||
    process.env.CLAUDE_CODE_MODEL ||
    "claude-sonnet-4-5";
  const usesAnthropicAutoInstrumentation = hasAnthropicAutoInstrumentation();

  try {
    const liveResponse = await startActiveObservation(
      "generate-dad-answer",
      async (agentObservation) => {
        agentObservation.update({
          input: {
            historyLength: history.length,
            message,
          },
          metadata: {
            model,
            transport: "anthropic-sdk",
            userId,
            usesAnthropicAutoInstrumentation,
          },
        });

        const generation = usesAnthropicAutoInstrumentation
          ? null
          : startObservation(
              "anthropic-messages-api",
              {
                model,
                input: {
                  systemPrompt,
                  messages: requestMessages,
                },
                metadata: {
                  transport: "anthropic-sdk",
                  tools: [
                    {
                      name: "web_search",
                      type: "web_search_20250305",
                      max_uses: 3,
                    },
                  ],
                  outputFormat: "json",
                  userId,
                },
              },
              { asType: "generation" },
            );

        try {
          const response = await getAnthropicClient().messages.create({
            model,
            max_tokens: 900,
            system: systemPrompt,
            messages: requestMessages,
            tools: [
              {
                name: "web_search",
                type: "web_search_20250305",
                max_uses: 3,
              },
            ],
          });
          const webSearchCount = traceWebSearchInvocations(response.content);
          const answer = extractAnswerText(response.content);

          if (!answer) {
            throw new Error("Anthropic Messages API returned no text answer.");
          }

          generation?.update({
            output: answer,
            usageDetails: toLangfuseUsageDetails(response.usage),
            metadata: {
              stopReason: response.stop_reason,
              stopSequence: response.stop_sequence ?? undefined,
              anthropicMessageId: response.id,
              webSearchCount,
            },
          });
          generation?.end();

          agentObservation.update({
            output: {
              answerPreview: answer.slice(0, 240),
              anthropicMessageId: response.id,
              webSearchCount,
            },
          });

          return {
            answer,
            anthropicMessageId: response.id,
            mode: "live" as const,
            profile,
          };
        } catch (error) {
          generation?.update({
            level: "ERROR",
            statusMessage:
              error instanceof Error
                ? error.message
                : "Unknown Claude execution error",
          });
          generation?.end();

          agentObservation.update({
            level: "ERROR",
            statusMessage:
              error instanceof Error
                ? error.message
                : "Unknown Claude execution error",
          });
          throw error;
        }
      },
      { asType: "agent" },
    );

    return liveResponse;
  } catch {
    return {
      answer: buildFallbackAnswer(profile, message),
      anthropicMessageId: null,
      mode: "fallback",
      profile,
    };
  }
}
