#!/usr/bin/env tsx
/**
 * Engram CLI — manual operations for memory management.
 * Usage:
 *   engram status           Show memory statistics
 *   engram search <query>   Search episodic + semantic memory
 *   engram consolidate      Run consolidation manually
 *   engram decay            Run a salience decay cycle
 *   engram reset            Clear all memory (destructive)
 */
import { resolve } from "node:path";
import {
  EngramStore,
  CueRetrieval,
  Consolidator,
  SalienceManager,
  DEFAULT_CONFIG,
  type EngramConfig,
} from "./core/index.js";

const config: EngramConfig = {
  ...DEFAULT_CONFIG,
  dbPath: resolve(process.env.ENGRAM_DB_PATH ?? ".engram/memory.db"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
};

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  const store = new EngramStore(config);

  try {
    switch (command) {
      case "status": {
        const s = store.stats();
        const semantics = store.getAllSemantics();
        const recent = store.getRecentEpisodes(10);

        console.log("\n  Engram Memory Status");
        console.log("  ====================");
        console.log(`  Episodes:    ${s.totalEpisodes} across ${s.sessions} sessions`);
        console.log(`  Semantics:   ${s.totalSemantics} entries`);
        console.log(`  Avg salience: ${s.avgSalience.toFixed(3)}`);

        if (semantics.length) {
          console.log("\n  Project Knowledge:");
          for (const sem of semantics) {
            console.log(`    [${sem.category}] ${sem.key}: ${sem.value}`);
          }
        }

        if (recent.length) {
          console.log("\n  Recent Episodes:");
          for (const ep of recent) {
            const status = ep.error ? "FAIL" : ep.outcome ? " OK " : " .. ";
            console.log(`    [${status}] ${ep.action}`);
          }
        }

        console.log();
        break;
      }

      case "search": {
        const query = args.join(" ");
        if (!query) {
          console.error("Usage: engram search <query>");
          process.exit(1);
        }

        const retrieval = new CueRetrieval(store);
        const cue = retrieval.extractCuesFromMessage(query);
        const result = retrieval.retrieve(cue);
        const formatted = retrieval.formatForContext(result);

        console.log(formatted || "No matching memories found.");
        break;
      }

      case "consolidate": {
        const consolidator = new Consolidator(store, config);
        const sessionId = args[0] ?? undefined;

        console.log("Running consolidation...");
        const result = await consolidator.consolidate(sessionId);

        console.log(`\n  ${result.summary}`);
        console.log(`  Promoted: ${result.promoted.length}`);
        console.log(`  Updated:  ${result.updated.length}`);
        console.log(`  Decayed:  ${result.decayed.length}\n`);
        break;
      }

      case "decay": {
        const salience = new SalienceManager(store, config);
        const report = salience.decayCycle();

        console.log("\n  Decay Cycle Complete");
        console.log(`  Episodes: ${report.beforeEpisodes} → ${report.afterEpisodes} (pruned ${report.prunedEpisodes})`);
        console.log(`  Semantics: ${report.beforeSemantics} → ${report.afterSemantics} (pruned ${report.prunedSemantics})\n`);
        break;
      }

      case "reset": {
        if (!args.includes("--confirm")) {
          console.error("This will delete all engram memory. Run with --confirm to proceed.");
          process.exit(1);
        }

        store.close();
        const { unlinkSync } = await import("node:fs");
        try {
          unlinkSync(config.dbPath);
          console.log("Memory cleared.");
        } catch {
          console.log("No memory database found.");
        }
        return;
      }

      default:
        console.log(`
  Engram — Bio-inspired memory for Claude Code

  Commands:
    status                Show memory statistics and project knowledge
    search <query>        Search episodic + semantic memory
    consolidate [sid]     Run consolidation (optionally for a specific session)
    decay                 Run a salience decay cycle
    reset --confirm       Clear all memory
`);
        break;
    }
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error("engram error:", err);
  process.exit(1);
});
