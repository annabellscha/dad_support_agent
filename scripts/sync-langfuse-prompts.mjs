import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const promptDefinitions = require("../lib/langfuse-prompts.json");

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getLangfuseBaseUrl() {
  return getRequiredEnv("LANGFUSE_BASE_URL").replace(/\/$/, "");
}

function getAuthorizationHeader() {
  const publicKey = getRequiredEnv("LANGFUSE_PUBLIC_KEY");
  const secretKey = getRequiredEnv("LANGFUSE_SECRET_KEY");

  return `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`;
}

async function createPrompt(definition) {
  const response = await fetch(`${getLangfuseBaseUrl()}/api/public/v2/prompts`, {
    body: JSON.stringify(definition),
    headers: {
      Authorization: getAuthorizationHeader(),
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const errorBody = await response.text();

    throw new Error(
      `Failed to sync ${definition.name}: ${response.status} ${response.statusText}\n${errorBody}`,
    );
  }

  return await response.json();
}

for (const definition of Object.values(promptDefinitions)) {
  const prompt = await createPrompt(definition);
  const labels = Array.isArray(prompt.labels) ? prompt.labels.join(", ") : "";

  console.log(
    `Synced ${prompt.name} version ${prompt.version}${labels ? ` [${labels}]` : ""}`,
  );
}
