import { NextResponse } from "next/server";

import { getWhatsAppSessionStoreInfo } from "@/lib/whatsapp-sessions";
import packageJson from "@/package.json";

export const runtime = "nodejs";

export async function GET() {
  const sessionStore = await getWhatsAppSessionStoreInfo();

  return NextResponse.json({
    ok: true,
    service: "dad-tech-support-agent",
    sessionStore,
    version: packageJson.version,
  });
}
