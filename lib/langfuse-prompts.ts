import promptDefinitions from "@/lib/langfuse-prompts.json";

type ManagedTextPromptSource = "langfuse" | "fallback";
export type DadSupportPromptMode = "default" | "code-red";

type ManagedPromptReference = {
  isFallback: boolean;
  name: string;
  version: number;
};

type CachedTextPrompt = {
  expiresAt: number;
  prompt: ManagedPromptReference;
  source: ManagedTextPromptSource;
  template: string;
};

type LangfusePromptState = {
  cache: Map<string, CachedTextPrompt>;
};

type TextPromptDefinition = {
  commitMessage?: string;
  labels?: string[];
  name: string;
  prompt: string;
  tags?: string[];
  type: "text";
};

type LangfuseTextPromptResponse = {
  name: string;
  prompt: string;
  type: "text";
  version: number;
};

declare global {
  var __dadSupportLangfusePromptState__: LangfusePromptState | undefined;
}

const dadSupportSystemPromptDefinition =
  promptDefinitions.dadSupportSystemPrompt as TextPromptDefinition;
const dadSupportCodeRedPromptDefinition =
  promptDefinitions.dadSupportCodeRedPrompt as TextPromptDefinition;

function getState() {
  if (!globalThis.__dadSupportLangfusePromptState__) {
    globalThis.__dadSupportLangfusePromptState__ = {
      cache: new Map<string, CachedTextPrompt>(),
    };
  }

  return globalThis.__dadSupportLangfusePromptState__;
}

function getCacheTtlMs() {
  const rawValue = process.env.LANGFUSE_PROMPT_CACHE_TTL_MS?.trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : NaN;

  if (Number.isFinite(parsedValue) && parsedValue >= 0) {
    return parsedValue;
  }

  return 30_000;
}

function getFailureCacheTtlMs() {
  return Math.min(getCacheTtlMs(), 5_000);
}

function getLangfusePromptEndpoint(promptName: string, label: string) {
  const baseUrl = process.env.LANGFUSE_BASE_URL?.trim();

  if (!baseUrl) {
    return null;
  }

  const sanitizedBaseUrl = baseUrl.replace(/\/$/, "");

  return `${sanitizedBaseUrl}/api/public/v2/prompts/${encodeURIComponent(promptName)}?label=${encodeURIComponent(label)}`;
}

function getLangfuseAuthHeader() {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();

  if (!publicKey || !secretKey) {
    return null;
  }

  return `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`;
}

function rememberPrompt(
  promptName: string,
  prompt: Omit<CachedTextPrompt, "expiresAt">,
  ttlMs: number,
) {
  const cachedPrompt = {
    ...prompt,
    expiresAt: Date.now() + ttlMs,
  };

  getState().cache.set(promptName, cachedPrompt);

  return cachedPrompt;
}

function buildFallbackPrompt(promptDefinition: TextPromptDefinition) {
  return {
    prompt: {
      isFallback: true,
      name: promptDefinition.name,
      version: 0,
    },
    source: "fallback" as const,
    template: promptDefinition.prompt,
  };
}

function compilePromptTemplate(
  template: string,
  variables: Record<string, string>,
) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = variables[key];

    return typeof value === "string" ? value : match;
  });
}

async function getManagedTextPrompt(promptDefinition: TextPromptDefinition) {
  const cachedPrompt = getState().cache.get(promptDefinition.name);

  if (cachedPrompt && cachedPrompt.expiresAt > Date.now()) {
    return cachedPrompt;
  }

  const promptLabel = promptDefinition.labels?.[0] || "production";
  const endpoint = getLangfusePromptEndpoint(promptDefinition.name, promptLabel);
  const authHeader = getLangfuseAuthHeader();

  if (!endpoint || !authHeader) {
    return rememberPrompt(
      promptDefinition.name,
      buildFallbackPrompt(promptDefinition),
      getFailureCacheTtlMs(),
    );
  }

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(`Langfuse prompt fetch failed with ${response.status}.`);
    }

    const prompt = (await response.json()) as LangfuseTextPromptResponse;

    if (prompt.type !== "text" || typeof prompt.prompt !== "string") {
      throw new Error("Expected a text prompt from Langfuse.");
    }

    return rememberPrompt(
      promptDefinition.name,
      {
        prompt: {
          isFallback: false,
          name: prompt.name,
          version: prompt.version,
        },
        source: "langfuse",
        template: prompt.prompt,
      },
      getCacheTtlMs(),
    );
  } catch {
    return rememberPrompt(
      promptDefinition.name,
      buildFallbackPrompt(promptDefinition),
      getFailureCacheTtlMs(),
    );
  }
}

function getPromptDefinitionForMode(promptMode: DadSupportPromptMode) {
  return promptMode === "code-red"
    ? dadSupportCodeRedPromptDefinition
    : dadSupportSystemPromptDefinition;
}

export async function getDadSupportSystemPrompt(
  userId: string,
  promptMode: DadSupportPromptMode = "default",
) {
  const prompt = await getManagedTextPrompt(getPromptDefinitionForMode(promptMode));

  return {
    content: compilePromptTemplate(prompt.template, { userId }),
    mode: promptMode,
    prompt: prompt.prompt,
    source: prompt.source,
  };
}
