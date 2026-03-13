#!/usr/bin/env tsx
/**
 * SessionEnd hook — fires when Claude Code session closes.
 * Runs consolidation: promotes patterns, resolves contradictions, decays noise.
 * Biological analog: sleep replay and systems consolidation.
 */
import { resolve } from "node:path";
import { EngramStore } from "../core/store.js";
import { Consolidator } from "../core/consolidation.js";
import { DEFAULT_CONFIG } from "../core/types.js";

async function main() {
  let event: Record<string, unknown> = {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    event = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    // No stdin — proceed
  }

  const sessionId = (event.session_id as string) ?? undefined;
  const dbPath = resolve(process.env.ENGRAM_DB_PATH ?? DEFAULT_CONFIG.dbPath);
  const store = new EngramStore({ dbPath });
  const consolidator = new Consolidator(store, {
    ...DEFAULT_CONFIG,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });

  try {
    await consolidator.consolidate(sessionId);
  } finally {
    store.close();
  }
}

main().catch(() => process.exit(0));
