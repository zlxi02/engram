#!/usr/bin/env tsx
/**
 * SessionStart hook — fires when Claude Code session begins.
 * Loads semantic store + recent episodes, injects as additionalContext.
 * Biological analog: neocortical priming on waking.
 */
import { resolve } from "node:path";
import { EngramStore } from "../core/store.js";
import { CueRetrieval } from "../core/retrieval.js";
import { DEFAULT_CONFIG } from "../core/types.js";

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  const dbPath = resolve(process.env.ENGRAM_DB_PATH ?? DEFAULT_CONFIG.dbPath);
  const store = new EngramStore({ dbPath });

  try {
    const retrieval = new CueRetrieval(store);
    const context = retrieval.primeForSession();

    if (context) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: context,
          },
        })
      );
    }
  } finally {
    store.close();
  }
}

main().catch(() => process.exit(0));
