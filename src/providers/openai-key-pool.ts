import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";

import { createOpenAIProvider } from "./openai.js";
import type { ProviderRegistration } from "./types.js";

export function createOpenAIKeyPool(file: string): ProviderRegistration {
  const path = resolve(file);
  const contents = readFileSync(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    // JSON.parse errors can contain pieces of the key file.
    throw new Error("GPT_IMAGE_API_KEYS_FILE must contain a valid JSON array.");
  }
  if (
    !Array.isArray(value) || value.length === 0 ||
    !value.every((key): key is string => typeof key === "string" && key.trim() !== "")
  ) {
    throw new Error("GPT_IMAGE_API_KEYS_FILE must contain a non-empty array of non-empty strings.");
  }

  const keys = [...new Set(value.map(key => key.trim()))];
  const providers = keys.map(key => createOpenAIProvider(key, { maxRetries: 0 }));
  if (providers.length === 1) return providers[0];
  // Changing the ordered key list gets its own cursor, including while older
  // server processes are still draining requests for the previous list.
  const poolId = createHash("sha256").update(JSON.stringify(keys)).digest("hex");

  return {
    ...providers[0],
    async generate(params) {
      // Keep the existing single-key path usable on earlier Node 22 versions.
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(path + ".state.sqlite");
      try {
        db.exec(`
          PRAGMA busy_timeout = 5000;
          CREATE TABLE IF NOT EXISTS key_pools (id TEXT PRIMARY KEY, cursor INTEGER NOT NULL);
        `);
        db.prepare("INSERT OR IGNORE INTO key_pools VALUES (?, 0)").run(poolId);
        const row = db.prepare("SELECT cursor FROM key_pools WHERE id = ?").get(poolId)!;
        const start = Number(row.cursor);
        const advance = db.prepare("UPDATE key_pools SET cursor = cursor + 1 WHERE id = ? AND cursor = ?");

        for (let cursor = start; ; cursor++) {
          try {
            return await providers[cursor % providers.length].generate(params);
          } catch (error) {
            const exhausted = error instanceof OpenAI.APIError &&
              error.status === 429 && error.code === "credit_balance_exhausted";
            if (!exhausted || cursor - start + 1 === providers.length) throw error;
            // Only the first concurrent failure for this cursor advances it.
            advance.run(poolId, cursor);
          }
        }
      } finally {
        db.close();
      }
    },
  };
}
