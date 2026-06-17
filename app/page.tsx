"use client";

import dadProfiles from "@/data/user-profiles.json";

import { useState, useTransition } from "react";

type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const starterPrompts = [
  "How do I make the words bigger?",
  "My screen keeps going dark too fast",
  "How do I block spam calls?",
];

export default function HomePage() {
  const dadProfile = dadProfiles[0];
  const profileNotes = dadProfile.notes.slice(0, 2);
  const [messages, setMessages] = useState<UIMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi Dad. Tell me what you want to do on your phone, and I’ll walk you through it step by step.",
    },
  ]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Ready to guide Dad step by step without making this feel like tech support.");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [lastTraceId, setLastTraceId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function sendMessage(rawMessage: string) {
    const message = rawMessage.trim();

    if (!message) {
      return;
    }

    const nextUserMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
    };

    const nextHistory = [...messages, nextUserMessage];

    setMessages(nextHistory);
    setInput("");
    setStatus("Checking Dad's phone details and lining up the next taps.");

    startTransition(async () => {
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            userId: "dad",
            sessionId,
            history: messages
              .filter((entry) => entry.id !== "welcome")
              .map(({ role, content }) => ({ role, content })),
          }),
        });

        if (!response.ok) {
          throw new Error("The server did not return a valid response.");
        }

        const payload = (await response.json()) as {
          answer: string;
          mode: "live" | "fallback";
          traceId?: string | null;
          profile?: { phoneModel?: string; osFamily?: string; osVersion?: string } | null;
        };

        setLastTraceId(payload.traceId ?? null);

        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: payload.answer,
          },
        ]);

        if (payload.mode === "live" && payload.profile) {
          setStatus(
            `Live mode is on for Dad's ${payload.profile.phoneModel ?? "phone"} on ${payload.profile.osFamily ?? "mobile"}.`,
          );
          return;
        }

        setStatus("Fallback mode is active. Add an Anthropic API key to get live answers.");
      } catch {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "Something went wrong on my side. Try again in a second, and I’ll help you from there.",
          },
        ]);
        setStatus("The request failed before the agent could answer.");
      }
    });
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div className="hero-topline">
          <div className="eyebrow">Family Tech Support</div>
          <div className="channel-badge">Web + WhatsApp</div>
        </div>
        <h1>Dad Support agent</h1>
        <p className="hero-copy">
          One calm assistant for everyday phone questions, with saved device context,
          step-by-step replies, and a tone that feels more like family help than a
          support queue.
        </p>
        <div className="support-note">
          Keeps short WhatsApp follow-ups in context and stays grounded in Dad&apos;s
          actual phone details.
        </div>

        <div className="profile-card">
          <div className="profile-card-header">
            <span className="profile-badge">Saved context</span>
            <p>This is what the assistant already knows before Dad asks anything.</p>
          </div>
          <div className="profile-grid">
            <div className="profile-item">
              <span className="profile-label">Person</span>
              <strong>Dad</strong>
            </div>
            <div className="profile-item is-wide">
              <span className="profile-label">Phone</span>
              <strong>{dadProfile.phoneModel}</strong>
            </div>
            <div className="profile-item">
              <span className="profile-label">OS</span>
              <strong>
                {dadProfile.osFamily} {dadProfile.osVersion}
              </strong>
            </div>
            <div className="profile-item">
              <span className="profile-label">Comfort level</span>
              <strong>{dadProfile.techComfort}</strong>
            </div>
          </div>
          <div className="profile-notes">
            {profileNotes.map((note) => (
              <div key={note} className="profile-note">
                {note}
              </div>
            ))}
          </div>
        </div>

        <div className="starter-section">
          <div className="section-kicker">Quick starts</div>
          <div className="starter-row">
            {starterPrompts.map((prompt) => (
              <button
                key={prompt}
                className="starter-chip"
                onClick={() => void sendMessage(prompt)}
                type="button"
                disabled={isPending}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="chat-panel">
        <div className="chat-header">
          <div>
            <div className="chat-title">Conversation</div>
            <div className="chat-subtitle">{status}</div>
            {lastTraceId ? (
              <div className="trace-caption">Trace active: {lastTraceId}</div>
            ) : null}
          </div>
          <div className={`status-pill ${isPending ? "is-busy" : ""}`}>
            {isPending ? "Replying" : "Standing by"}
          </div>
        </div>

        <div className="message-list">
          {messages.map((message) => (
            <article
              key={message.id}
              className={`message-bubble ${message.role === "user" ? "is-user" : "is-assistant"}`}
            >
              <span className="message-role">
                {message.role === "user" ? "Dad" : "Support"}
              </span>
              <p>{message.content}</p>
            </article>
          ))}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage(input);
          }}
        >
          <label className="composer-label" htmlFor="chat-input">
            What do you need help with on your phone?
          </label>
          <div className="composer-row">
            <textarea
              id="chat-input"
              className="composer-input"
              value={input}
              rows={2}
              placeholder="Example: The words in my text messages are too small."
              onChange={(event) => setInput(event.target.value)}
              disabled={isPending}
            />
            <button className="send-button" type="submit" disabled={isPending}>
              Send
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
