#!/usr/bin/env tsx
/**
 * PostToolUse hook — fires after every successful tool call.
 * Encodes the tool action as a structured episode in the store.
 * Biological analog: hippocampal encoding of experience.
 */
import { resolve } from "node:path";
import { EngramStore } from "../core/store.js";
import { EpisodeEncoder } from "../core/encoder.js";
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

  const sessionId = (event.session_id as string) ?? `session_${Date.now()}`;
  const toolName = (event.tool_name as string) ?? "";
  const toolInput = (event.tool_input as Record<string, unknown>) ?? {};
  const toolOutput = (event.tool_output as string) ?? null;

  if (shouldSkip(toolName)) process.exit(0);

  const dbPath = resolve(process.env.ENGRAM_DB_PATH ?? DEFAULT_CONFIG.dbPath);
  const store = new EngramStore({ dbPath });

  try {
    const encoder = new EpisodeEncoder(store, sessionId);
    encoder.encodeToolUse(toolName, toolInput, toolOutput);
  } finally {
    store.close();
  }
}

function shouldSkip(toolName: string): boolean {
  if (toolName.startsWith("mcp__engram")) return true;
  if (toolName === "ReadLints") return true;
  if (toolName === "TodoWrite") return true;
  if (toolName === "AskQuestion") return true;
  return false;
}

main().catch(() => process.exit(0));
