import { ensureLangfuseInstrumentation } from "./lib/langfuse";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await ensureLangfuseInstrumentation();
  }
}
