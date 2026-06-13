import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  TextBlock,
  WebSearchResultBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";

import { startActiveObservation, startObservation } from "@langfuse/tracing";

import {
  getDadSupportSystemPrompt,
  type DadSupportPromptMode,
} from "@/lib/langfuse-prompts";
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

type WebSearchLink = {
  title: string | null;
  url: string;
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
  includeProfileContext = true,
): MessageParam[] {
  const messages: MessageParam[] = includeProfileContext
    ? [
        {
          role: "user",
          content: buildProfileContext(profile),
        },
      ]
    : [];

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

function parsePromptMode(
  message: string,
): {
  normalizedMessage: string;
  promptMode: DadSupportPromptMode;
} {
  const codeRedPrefixPattern = /^\s*code\s+red\b[\s:,-]*/i;
  const match = message.match(codeRedPrefixPattern);

  if (!match) {
    return {
      normalizedMessage: message,
      promptMode: "default",
    };
  }

  const normalizedMessage = message.slice(match[0].length).trim();

  return {
    normalizedMessage: normalizedMessage || message.trim(),
    promptMode: "code-red",
  };
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

function extractWebSearchLinks(
  content: Anthropic.Messages.ContentBlock[],
): WebSearchLink[] {
  const seenUrls = new Set<string>();
  const links: WebSearchLink[] = [];

  for (const block of content) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) {
      continue;
    }

    for (const result of block.content) {
      if (!result.url || seenUrls.has(result.url)) {
        continue;
      }

      seenUrls.add(result.url);
      links.push({
        title: result.title ?? null,
        url: result.url,
      });
    }
  }

  return links;
}

function appendSourceLinks(
  answer: string,
  webSearchLinks: WebSearchLink[],
) {
  if (webSearchLinks.length === 0 || /https?:\/\//i.test(answer)) {
    return answer;
  }

  const helpfulLinks = webSearchLinks
    .slice(0, 2)
    .map((link, index) =>
      link.title
        ? `${index + 1}. ${link.title}: ${link.url}`
        : `${index + 1}. ${link.url}`,
    )
    .join("\n");

  return `${answer}\n\nHelpful links:\n${helpfulLinks}`;
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

  const { normalizedMessage, promptMode } = parsePromptMode(message);
  const systemPromptDetails = await getDadSupportSystemPrompt(userId, promptMode);
  const systemPrompt = systemPromptDetails.content;
  const requestMessages = buildMessages(
    profile,
    history,
    normalizedMessage,
    promptMode !== "code-red",
  );
  const model =
    process.env.ANTHROPIC_MODEL ||
    process.env.CLAUDE_CODE_MODEL ||
    "claude-sonnet-4-5";

  try {
    const liveResponse = await startActiveObservation(
      "generate-dad-answer",
      async (agentObservation) => {
        agentObservation.update({
          input: {
            historyLength: history.length,
            message,
            normalizedMessage,
          },
          metadata: {
            model,
            managedPrompt: systemPromptDetails.prompt,
            promptMode,
            promptSource: systemPromptDetails.source,
            transport: "anthropic-sdk",
            userId,
          },
        });

        const result = await startActiveObservation(
          "dad-support-generation",
          async (generation) => {
            generation.update({
              input: {
                messages: requestMessages,
                rawUserMessage: message,
                systemPrompt,
                transformedUserMessage: normalizedMessage,
              },
              metadata: {
                outputFormat: "text",
                promptMode,
                promptSource: systemPromptDetails.source,
                toolChoice: "auto",
                tools: [
                  {
                    name: "web_search",
                    type: "web_search_20250305",
                    max_uses: 3,
                  },
                ],
                transport: "anthropic-sdk",
                userId,
              },
              model,
              modelParameters: {
                max_tokens: 900,
              },
              prompt: systemPromptDetails.prompt,
            });

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
              const webSearchLinks = extractWebSearchLinks(response.content);
              const answer = appendSourceLinks(
                extractAnswerText(response.content),
                webSearchLinks,
              );

              if (!answer) {
                throw new Error("Anthropic Messages API returned no text answer.");
              }

              generation.update({
                output: answer,
                prompt: systemPromptDetails.prompt,
                usageDetails: toLangfuseUsageDetails(response.usage),
                metadata: {
                  contentBlocks: response.content,
                  stopReason: response.stop_reason,
                  stopSequence: response.stop_sequence ?? undefined,
                  anthropicMessageId: response.id,
                  promptMode,
                  promptSource: systemPromptDetails.source,
                  rawAssistantText: extractAnswerText(response.content),
                  webSearchCount,
                  webSearchLinks,
                },
              });

              return {
                answer,
                anthropicMessageId: response.id,
                webSearchCount,
              };
            } catch (error) {
              generation.update({
                level: "ERROR",
                prompt: systemPromptDetails.prompt,
                statusMessage:
                  error instanceof Error
                    ? error.message
                    : "Unknown Claude execution error",
              });
              throw error;
            }
          },
          { asType: "generation" },
        );

        agentObservation.update({
          output: {
            answerPreview: result.answer.slice(0, 240),
            anthropicMessageId: result.anthropicMessageId,
            webSearchCount: result.webSearchCount,
          },
        });

        return {
          answer: result.answer,
          anthropicMessageId: result.anthropicMessageId,
          mode: "live" as const,
          profile,
        };
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
