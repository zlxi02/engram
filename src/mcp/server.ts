#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  EngramStore,
  EpisodeEncoder,
  CueRetrieval,
  Consolidator,
  loadEngramConfig,
} from "../core/index.js";
import type { EpisodeType, SemanticCategory } from "../core/types.js";

const config = loadEngramConfig();

const store = new EngramStore(config);
const retrieval = new CueRetrieval(store);
const consolidator = new Consolidator(store, config);
const sessionId = process.env.ENGRAM_SESSION_ID ?? `session_${Date.now()}`;
const encoder = new EpisodeEncoder(store, sessionId);

const server = new McpServer({
  name: "engram",
  version: "0.1.0",
});

// ── engram_search ──────────────────────────────────────────────────────────

server.tool(
  "engram_search",
  "Search engram memory for relevant episodes and project knowledge. Use when you want to recall past work, check if something was tried before, or understand prior decisions.",
  {
    query: z.string().describe("What to search for — files, concepts, errors, or goals"),
    files: z.array(z.string()).optional().describe("File paths to search for in episode history"),
    tags: z.array(z.string()).optional().describe("Tags to filter by (e.g. 'auth', 'test', 'bugfix')"),
  },
  async ({ query, files, tags }) => {
    const cue = retrieval.extractCuesFromMessage(query);
    if (files?.length) cue.files = [...(cue.files ?? []), ...files];
    if (tags?.length) cue.tags = [...(cue.tags ?? []), ...tags];

    const result = retrieval.retrieve(cue);
    const formatted = retrieval.formatForContext(result);

    return {
      content: [
        {
          type: "text" as const,
          text: formatted || "No matching memories found.",
        },
      ],
    };
  }
);

// ── engram_store ───────────────────────────────────────────────────────────

server.tool(
  "engram_store",
  "Explicitly store a memory in engram. Use for important decisions, architectural choices, or lessons learned that should persist across sessions.",
  {
    type: z
      .enum(["investigation", "attempt", "success", "failure", "decision", "observation", "plan"])
      .describe("Type of episode"),
    goal: z.string().describe("What you were trying to accomplish"),
    action: z.string().describe("What was done"),
    files: z.array(z.string()).optional().describe("Files involved"),
    outcome: z.string().optional().describe("What happened (for successes)"),
    error: z.string().optional().describe("What went wrong (for failures)"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
  },
  async ({ type, goal, action, files, outcome, error, tags }) => {
    const episode = encoder.encodeManual({
      sessionId,
      type: type as EpisodeType,
      goal,
      action,
      files,
      outcome,
      error,
      tags,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Stored episode ${episode.id}: [${episode.type}] ${episode.action}`,
        },
      ],
    };
  }
);

// ── engram_status ──────────────────────────────────────────────────────────

server.tool(
  "engram_status",
  "Show engram memory statistics and recent project knowledge. Use at session start to understand what's known about this project.",
  {},
  async () => {
    const s = store.stats();
    const semantics = store.getAllSemantics();
    const recent = store.getRecentEpisodes(5);

    const parts = [
      `# Engram Memory Status`,
      ``,
      `- **Episodes**: ${s.totalEpisodes} across ${s.sessions} sessions`,
      `- **Semantic entries**: ${s.totalSemantics}`,
      `- **Average salience**: ${s.avgSalience.toFixed(2)}`,
    ];

    if (semantics.length) {
      parts.push("", "## Project Knowledge");
      for (const sem of semantics) {
        parts.push(`- **[${sem.category}] ${sem.key}**: ${sem.value}`);
      }
    }

    if (recent.length) {
      parts.push("", "## Recent Episodes");
      for (const ep of recent) {
        const status = ep.error ? "FAILED" : ep.outcome ? "OK" : "...";
        parts.push(`- [${status}] ${ep.action}`);
      }
    }

    return {
      content: [{ type: "text" as const, text: parts.join("\n") }],
    };
  }
);

// ── engram_consolidate ─────────────────────────────────────────────────────

server.tool(
  "engram_consolidate",
  "Run memory consolidation (the 'sleep' process). Promotes patterns to semantic memory, resolves contradictions, and decays low-value episodes. Typically runs automatically at session end.",
  {
    session_id: z.string().optional().describe("Session ID to consolidate. Omit for recent episodes."),
  },
  async ({ session_id }) => {
    const result = await consolidator.consolidate(session_id);

    const parts = [
      `# Consolidation Complete`,
      ``,
      `${result.summary}`,
      ``,
      `- **Promoted**: ${result.promoted.length} new knowledge entries`,
      `- **Updated**: ${result.updated.length} existing entries corrected`,
      `- **Decayed**: ${result.decayed.length} low-value episodes`,
    ];

    if (result.promoted.length) {
      parts.push("", "## New Knowledge");
      for (const p of result.promoted) {
        parts.push(`- [${p.category}] **${p.key}**: ${p.value}`);
      }
    }

    return {
      content: [{ type: "text" as const, text: parts.join("\n") }],
    };
  }
);

// ── Start server ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Engram MCP server running on stdio");
}

main().catch((err) => {
  console.error("Failed to start engram MCP server:", err);
  process.exit(1);
});
