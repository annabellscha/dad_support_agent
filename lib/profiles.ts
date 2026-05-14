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
