import { LangfuseSpanProcessor } from "@langfuse/otel";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

type LangfuseState = {
  initialized: boolean;
  initializing: Promise<void> | null;
  sdk: NodeSDK | null;
  spanProcessor: LangfuseSpanProcessor | null;
  anthropicAutoInstrumentation: boolean;
};

declare global {
  var __dadTechLangfuseState__: LangfuseState | undefined;
}

function getState() {
  if (!globalThis.__dadTechLangfuseState__) {
    globalThis.__dadTechLangfuseState__ = {
      initialized: false,
      initializing: null,
      sdk: null,
      spanProcessor: null,
      anthropicAutoInstrumentation: false,
    };
  }

  return globalThis.__dadTechLangfuseState__;
}

export function isLangfuseConfigured() {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY &&
      process.env.LANGFUSE_SECRET_KEY &&
      process.env.LANGFUSE_BASE_URL,
  );
}

async function createInstrumentations() {
  try {
    const [{ AnthropicInstrumentation }, anthropicModule] = await Promise.all([
      import("@arizeai/openinference-instrumentation-anthropic"),
      import("@anthropic-ai/sdk"),
    ]);
    const Anthropic = anthropicModule.default;

    if (!Anthropic) {
      return {
        anthropicAutoInstrumentation: false,
        instrumentations: [] as any[],
      };
    }

    const anthropicInstrumentation = new AnthropicInstrumentation();
    anthropicInstrumentation.manuallyInstrument(Anthropic);

    return {
      anthropicAutoInstrumentation: true,
      instrumentations: [anthropicInstrumentation],
    };
  } catch {
    return {
      anthropicAutoInstrumentation: false,
      instrumentations: [] as any[],
    };
  }
}

export async function ensureLangfuseInstrumentation() {
  const state = getState();

  if (state.initialized || !isLangfuseConfigured()) {
    return;
  }

  if (state.initializing) {
    await state.initializing;
    return;
  }

  state.initializing = (async () => {
    const spanProcessor = new LangfuseSpanProcessor();
    const { anthropicAutoInstrumentation, instrumentations } =
      await createInstrumentations();
    const sdk = new NodeSDK({
      instrumentations,
      spanProcessors: [spanProcessor],
    });

    sdk.start();
    setLangfuseTracerProvider(null);

    state.initialized = true;
    state.sdk = sdk;
    state.spanProcessor = spanProcessor;
    state.anthropicAutoInstrumentation = anthropicAutoInstrumentation;
  })();

  try {
    await state.initializing;
  } finally {
    state.initializing = null;
  }
}

export function getLangfuseSpanProcessor() {
  return getState().spanProcessor;
}

export function hasAnthropicAutoInstrumentation() {
  return getState().anthropicAutoInstrumentation;
}
