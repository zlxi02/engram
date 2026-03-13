#!/usr/bin/env tsx
/**
 * PreToolUse hook — fires before every tool call Claude makes.
 * Extracts cues from tool input, retrieves matching episodes,
 * injects as additionalContext so Claude sees relevant history.
 * Biological analog: hippocampal CA3 pattern completion.
 */
import { resolve } from "node:path";
import { EngramStore } from "../core/store.js";
import { CueRetrieval } from "../core/retrieval.js";
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
    process.exit(0);
  }

  const toolName = (event.tool_name as string) ?? "";
  const toolInput = (event.tool_input as Record<string, unknown>) ?? {};

  // Skip retrieval for engram's own MCP tools to avoid recursion
  if (toolName.startsWith("mcp__engram")) process.exit(0);

  const dbPath = resolve(process.env.ENGRAM_DB_PATH ?? DEFAULT_CONFIG.dbPath);
  const store = new EngramStore({ dbPath });

  try {
    const retrieval = new CueRetrieval(store);
    const context = retrieval.retrieveForToolUse(toolName, toolInput);

    if (context) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext: `[Engram Memory]\n${context}`,
          },
        })
      );
    }
  } finally {
    store.close();
  }
}

main().catch(() => process.exit(0));
