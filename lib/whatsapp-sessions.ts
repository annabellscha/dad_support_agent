import type { ChatTurn } from "@/lib/dad-support-agent";

const MAX_STORED_TURNS = 8;

declare global {
  var __dadTechWhatsappSessions__:
    | Map<string, ChatTurn[]>
    | undefined;
}

function getSessionStore() {
  if (!globalThis.__dadTechWhatsappSessions__) {
    globalThis.__dadTechWhatsappSessions__ = new Map<string, ChatTurn[]>();
  }

  return globalThis.__dadTechWhatsappSessions__;
}

export function getWhatsAppHistory(sessionId: string) {
  const history = getSessionStore().get(sessionId) ?? [];
  return history.map((turn) => ({ ...turn }));
}

export function appendWhatsAppExchange(
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
) {
  const nextHistory = [
    ...getWhatsAppHistory(sessionId),
    { role: "user", content: userMessage } as const,
    { role: "assistant", content: assistantMessage } as const,
  ].slice(-MAX_STORED_TURNS);

  getSessionStore().set(sessionId, nextHistory);
}
