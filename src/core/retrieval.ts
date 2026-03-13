import { EngramStore } from "./store.js";
import type {
  RetrievalCue,
  RetrievalResult,
  Episode,
  SemanticEntry,
} from "./types.js";

/**
 * Cue-based retrieval — the hippocampal CA3 pattern completion analog.
 * Extracts cues from current context, searches the store, and formats
 * results for injection into Claude's context.
 */
export class CueRetrieval {
  constructor(private store: EngramStore) {}

  /**
   * Main retrieval: given cues, return matching episodes and semantics.
   */
  retrieve(cue: RetrievalCue): RetrievalResult {
    const episodes = this.store.searchEpisodes({
      files: cue.files,
      tags: cue.tags,
      keywords: cue.keywords,
    });

    const semanticKeywords = [
      ...(cue.keywords ?? []),
      ...(cue.tags ?? []),
      ...(cue.files?.map(fileToKeywords).flat() ?? []),
    ];

    const semantics = semanticKeywords.length
      ? this.store.searchSemantics({ keywords: semanticKeywords })
      : this.store.getAllSemantics();

    return {
      episodes,
      semantics,
      totalEpisodes: episodes.length,
      totalSemantics: semantics.length,
    };
  }

  /**
   * Extract cues from a user message. Pulls out file paths,
   * identifiable keywords, and potential tags.
   */
  extractCuesFromMessage(message: string): RetrievalCue {
    return {
      files: extractFilePaths(message),
      keywords: extractKeywords(message),
      tags: extractMessageTags(message),
    };
  }

  /**
   * Extract cues from a tool call (PreToolUse context).
   * More structured than message extraction.
   */
  extractCuesFromToolUse(
    toolName: string,
    toolInput: Record<string, unknown>
  ): RetrievalCue {
    const cue: RetrievalCue = { files: [], tags: [], keywords: [] };

    switch (toolName) {
      case "Read":
      case "Write":
      case "Edit":
      case "StrReplace": {
        const path = (toolInput.file_path ?? toolInput.path) as string | undefined;
        if (path) {
          cue.files = [path];
          cue.tags = fileToKeywords(path);
        }
        break;
      }
      case "Bash":
      case "Shell": {
        const command = toolInput.command as string | undefined;
        if (command) {
          cue.keywords = extractKeywords(command);
          cue.files = extractFilePaths(command);
        }
        break;
      }
      case "Grep":
      case "SemanticSearch": {
        const pattern = (toolInput.pattern ?? toolInput.query) as string | undefined;
        if (pattern) cue.keywords = extractKeywords(pattern);
        const path = toolInput.path as string | undefined;
        if (path) cue.files = [path];
        break;
      }
      case "Glob": {
        const pattern = toolInput.glob_pattern as string | undefined;
        if (pattern) {
          cue.keywords = extractKeywords(pattern.replace(/\*/g, " "));
        }
        break;
      }
    }

    return cue;
  }

  /**
   * Format retrieval results as a context string for injection
   * into Claude's additionalContext.
   */
  formatForContext(result: RetrievalResult): string {
    if (!result.episodes.length && !result.semantics.length) {
      return "";
    }

    const parts: string[] = [];

    if (result.semantics.length) {
      parts.push("## Project Knowledge (from previous sessions)");
      for (const s of result.semantics) {
        parts.push(`- **[${s.category}] ${s.key}**: ${s.value}`);
      }
    }

    if (result.episodes.length) {
      parts.push("");
      parts.push("## Relevant History");
      for (const ep of result.episodes) {
        const status = ep.error ? "FAILED" : ep.outcome ? "OK" : "...";
        let line = `- [${status}] ${ep.action}`;
        if (ep.outcome) line += ` → ${ep.outcome}`;
        if (ep.error) line += ` ⚠ ${ep.error}`;
        parts.push(line);
      }
    }

    return parts.join("\n");
  }

  /**
   * Full pipeline: extract cues from tool input, retrieve, format.
   * Returns empty string if nothing relevant found.
   */
  retrieveForToolUse(
    toolName: string,
    toolInput: Record<string, unknown>
  ): string {
    const cue = this.extractCuesFromToolUse(toolName, toolInput);
    if (!cue.files?.length && !cue.tags?.length && !cue.keywords?.length) {
      return "";
    }
    const result = this.retrieve(cue);
    return this.formatForContext(result);
  }

  /**
   * Session priming: get semantic store + diverse high-salience episodes.
   * Selects up to 10 episodes from a 30-entry candidate pool, applying
   * type-priority weighting and a per-file cap of 2 to avoid noise from
   * editing bursts on a single file.
   */
  primeForSession(): string {
    const semantics = this.store.getAllSemantics();
    const episodes = this.selectDiverseEpisodes();

    const result: RetrievalResult = {
      episodes,
      semantics,
      totalEpisodes: episodes.length,
      totalSemantics: semantics.length,
    };

    if (!result.episodes.length && !result.semantics.length) {
      return "";
    }

    const parts = [
      "# Engram Memory — Session Context",
      "",
      this.formatForContext(result),
    ];

    return parts.join("\n");
  }

  private selectDiverseEpisodes(): Episode[] {
    const TYPE_WEIGHT: Record<string, number> = {
      failure: 3,
      decision: 3,
      plan: 3,
      success: 2,
      attempt: 1,
      observation: 1,
      investigation: 0,
    };

    const candidates = this.store.searchEpisodes({ limit: 30 });
    if (!candidates.length) {
      return this.store.getRecentEpisodes(10);
    }

    const fileCounts = new Map<string, number>();
    const seenActions = new Set<string>();
    const selected: Episode[] = [];

    // Sort by (type weight DESC, salience DESC) — candidates already sorted by salience
    const scored = candidates.map((ep) => ({
      ep,
      weight: TYPE_WEIGHT[ep.type] ?? 1,
    }));
    scored.sort((a, b) =>
      b.weight !== a.weight ? b.weight - a.weight : b.ep.salience - a.ep.salience
    );

    for (const { ep } of scored) {
      if (selected.length >= 10) break;
      if (seenActions.has(ep.action)) continue;
      const files: string[] = ep.files ?? [];
      const dominated = files.some((f) => (fileCounts.get(f) ?? 0) >= 2);
      if (dominated) continue;
      for (const f of files) fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
      seenActions.add(ep.action);
      selected.push(ep);
    }

    return selected.length ? selected : this.store.getRecentEpisodes(10);
  }
}

// ── Cue extraction helpers ─────────────────────────────────────────────────

const FILE_PATH_RE = /(?:[\w.-]+\/)+[\w.-]+\.\w+/g;

function extractFilePaths(text: string): string[] {
  const matches = text.match(FILE_PATH_RE) ?? [];
  return [...new Set(matches)];
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "above", "below", "between", "out", "off",
  "over", "under", "again", "further", "then", "once", "here", "there",
  "when", "where", "why", "how", "all", "each", "every", "both", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not", "only",
  "own", "same", "so", "than", "too", "very", "just", "because", "but",
  "and", "or", "if", "it", "its", "this", "that", "these", "those", "i",
  "me", "my", "we", "our", "you", "your", "he", "him", "his", "she",
  "her", "they", "them", "their", "what", "which", "who", "whom",
]);

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

function extractMessageTags(message: string): string[] {
  const tags: string[] = [];
  const lower = message.toLowerCase();

  if (/auth|login|token|jwt|session|password/i.test(lower)) tags.push("auth");
  if (/database|sql|query|migration|prisma|drizzle/i.test(lower)) tags.push("database");
  if (/api|endpoint|route|handler|rest|graphql/i.test(lower)) tags.push("api");
  if (/test|spec|assert|expect|jest|vitest/i.test(lower)) tags.push("test");
  if (/bug|fix|error|crash|broken/i.test(lower)) tags.push("bugfix");
  if (/refactor|clean|restructure|rename/i.test(lower)) tags.push("refactor");
  if (/deploy|ci|cd|pipeline|docker/i.test(lower)) tags.push("devops");
  if (/style|css|ui|component|layout/i.test(lower)) tags.push("ui");

  return tags;
}

function fileToKeywords(path: string): string[] {
  return path
    .split("/")
    .pop()!
    .replace(/\.\w+$/, "")
    .split(/[-_.]/)
    .filter((w) => w.length > 2);
}
