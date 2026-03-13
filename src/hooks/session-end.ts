#!/usr/bin/env tsx
/**
 * SessionEnd hook — fires when Claude Code session closes.
 * Runs consolidation: promotes patterns, resolves contradictions, decays noise.
 * Biological analog: sleep replay and systems consolidation.
 */
import { EngramStore } from "../core/store.js";
import { Consolidator } from "../core/consolidation.js";
import { loadEngramConfig } from "../core/config.js";

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
  const config = loadEngramConfig();
  const store = new EngramStore(config);
  const consolidator = new Consolidator(store, config);

  try {
    await consolidator.consolidate(sessionId);
  } finally {
    store.close();
  }
}

main().catch(() => process.exit(0));
