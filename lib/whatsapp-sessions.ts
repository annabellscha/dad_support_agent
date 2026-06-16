import { Redis as UpstashRedis } from "@upstash/redis";
import type { ChatTurn } from "@/lib/dad-support-agent";
import { createClient, type RedisClientType } from "redis";

const MAX_STORED_TURNS = 8;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24;

type PersistentSessionClient =
  | {
      backend: "redis";
      client: RedisClientType;
    }
  | {
      backend: "upstash";
      client: UpstashRedis;
    }
  | null;

declare global {
  var __dadTechWhatsappSessions__:
    | Map<string, ChatTurn[]>
    | undefined;
  var __dadTechWhatsappRedisClient__:
    | Promise<RedisClientType | null>
    | undefined;
  var __dadTechWhatsappUpstashClient__:
    | UpstashRedis
    | undefined;
}

function getSessionStore() {
  if (!globalThis.__dadTechWhatsappSessions__) {
    globalThis.__dadTechWhatsappSessions__ = new Map<string, ChatTurn[]>();
  }

  return globalThis.__dadTechWhatsappSessions__;
}

function getSessionTtlSeconds() {
  const rawValue = process.env.WHATSAPP_SESSION_TTL_SECONDS?.trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : NaN;

  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return parsedValue;
  }

  return DEFAULT_SESSION_TTL_SECONDS;
}

function getSessionKey(sessionId: string) {
  return `whatsapp-session:${sessionId}`;
}

function normalizeHistory(history: unknown): ChatTurn[] {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(
      (turn): turn is ChatTurn =>
        Boolean(turn) &&
        typeof turn === "object" &&
        "role" in turn &&
        "content" in turn &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string",
    )
    .slice(-MAX_STORED_TURNS)
    .map((turn) => ({ ...turn }));
}

async function getRedisClient() {
  const redisUrl = process.env.REDIS_URL?.trim();

  if (!redisUrl) {
    return null;
  }

  if (!globalThis.__dadTechWhatsappRedisClient__) {
    globalThis.__dadTechWhatsappRedisClient__ = (async () => {
      const client = createClient({
        url: redisUrl,
      });

      client.on("error", () => {
        globalThis.__dadTechWhatsappRedisClient__ = undefined;
      });

      await client.connect();

      return client;
    })().catch(() => {
      globalThis.__dadTechWhatsappRedisClient__ = undefined;
      return null;
    });
  }

  return await globalThis.__dadTechWhatsappRedisClient__;
}

function hasUpstashEnv() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

function getUpstashClient() {
  if (!hasUpstashEnv()) {
    return null;
  }

  if (!globalThis.__dadTechWhatsappUpstashClient__) {
    globalThis.__dadTechWhatsappUpstashClient__ = UpstashRedis.fromEnv();
  }

  return globalThis.__dadTechWhatsappUpstashClient__;
}

async function getPersistentSessionClient(): Promise<PersistentSessionClient> {
  const redisClient = await getRedisClient();

  if (redisClient) {
    return {
      backend: "redis",
      client: redisClient,
    };
  }

  const upstashClient = getUpstashClient();

  if (upstashClient) {
    return {
      backend: "upstash",
      client: upstashClient,
    };
  }

  return null;
}

export async function getWhatsAppHistory(sessionId: string) {
  const persistentClient = await getPersistentSessionClient();
  const sessionKey = getSessionKey(sessionId);

  if (persistentClient?.backend === "redis") {
    const rawHistory = await persistentClient.client.get(sessionKey);

    if (!rawHistory) {
      return [];
    }

    try {
      return normalizeHistory(JSON.parse(rawHistory));
    } catch {
      return [];
    }
  }

  if (persistentClient?.backend === "upstash") {
    const rawHistory = await persistentClient.client.get<string>(sessionKey);

    if (!rawHistory) {
      return [];
    }

    try {
      return normalizeHistory(JSON.parse(rawHistory));
    } catch {
      return [];
    }
  }

  const history = getSessionStore().get(sessionId) ?? [];
  return history.map((turn) => ({ ...turn }));
}

export async function appendWhatsAppExchange(
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
) {
  const nextHistory = [
    ...(await getWhatsAppHistory(sessionId)),
    { role: "user", content: userMessage } as const,
    { role: "assistant", content: assistantMessage } as const,
  ].slice(-MAX_STORED_TURNS);

  const persistentClient = await getPersistentSessionClient();
  const sessionKey = getSessionKey(sessionId);
  const serializedHistory = JSON.stringify(nextHistory);
  const sessionTtlSeconds = getSessionTtlSeconds();

  if (persistentClient?.backend === "redis") {
    await persistentClient.client.set(sessionKey, serializedHistory, {
      EX: sessionTtlSeconds,
    });
    return;
  }

  if (persistentClient?.backend === "upstash") {
    await persistentClient.client.set(sessionKey, serializedHistory, {
      ex: sessionTtlSeconds,
    });
    return;
  }

  getSessionStore().set(sessionId, nextHistory);
}

export async function getWhatsAppSessionStoreInfo() {
  const persistentClient = await getPersistentSessionClient();

  return {
    backend: persistentClient?.backend ?? "memory",
    configuredRedisUrl: Boolean(process.env.REDIS_URL?.trim()),
    configuredUpstashRedis: hasUpstashEnv(),
    sessionTtlSeconds: getSessionTtlSeconds(),
  };
}
