import { readFile } from "node:fs/promises";
import path from "node:path";

export type UserProfile = {
  id: string;
  name: string;
  relationship: string;
  phoneModel: string;
  osFamily: string;
  osVersion: string;
  carrier: string;
  phoneNumbers?: string[];
  techComfort: "low" | "medium" | "high";
  notes: string[];
  preferences: {
    tone: string;
    avoidJargon: boolean;
  };
};

async function loadProfiles() {
  const filePath = path.join(process.cwd(), "data", "user-profiles.json");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as UserProfile[];
}

export async function getUserProfile(userId: string) {
  const profiles = await loadProfiles();
  return profiles.find((profile) => profile.id === userId) ?? null;
}

export function normalizePhoneIdentifier(value: string) {
  const withoutChannelPrefix = value.trim().replace(/^whatsapp:/i, "");
  const normalized = withoutChannelPrefix.replace(/[^\d+]/g, "");

  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("+")) {
    return normalized;
  }

  return `+${normalized}`;
}

export async function getUserProfileByPhoneNumber(phoneNumber: string) {
  const normalizedPhoneNumber = normalizePhoneIdentifier(phoneNumber);

  if (!normalizedPhoneNumber) {
    return null;
  }

  const profiles = await loadProfiles();

  return (
    profiles.find((profile) =>
      profile.phoneNumbers?.some(
        (candidate) =>
          normalizePhoneIdentifier(candidate) === normalizedPhoneNumber,
      ),
    ) ?? null
  );
}
