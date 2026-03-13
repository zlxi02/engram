// ── Episode types ──────────────────────────────────────────────────────────

export type EpisodeType =
  | "investigation"
  | "attempt"
  | "success"
  | "failure"
  | "decision"
  | "observation"
  | "plan";

export interface Episode {
  id: string;
  sessionId: string;
  timestamp: string;
  type: EpisodeType;
  goal: string;
  action: string;
  files: string[];
  outcome: string | null;
  error: string | null;
  tags: string[];
  salience: number;
  accessCount: number;
  lastAccessed: string;
}

export interface EpisodeInput {
  sessionId: string;
  type: EpisodeType;
  goal: string;
  action: string;
  files?: string[];
  outcome?: string;
  error?: string;
  tags?: string[];
}

// ── Semantic memory types ──────────────────────────────────────────────────

export type SemanticCategory =
  | "architecture"
  | "pattern"
  | "decision"
  | "convention"
  | "dependency"
  | "bug_pattern";

export interface SemanticEntry {
  id: string;
  category: SemanticCategory;
  key: string;
  value: string;
  source_episodes: string[];
  salience: number;
  accessCount: number;
  lastAccessed: string;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticInput {
  category: SemanticCategory;
  key: string;
  value: string;
  source_episodes?: string[];
}

// ── Retrieval types ────────────────────────────────────────────────────────

export interface RetrievalCue {
  files?: string[];
  tags?: string[];
  keywords?: string[];
  goal?: string;
  sessionId?: string;
}

export interface RetrievalResult {
  episodes: Episode[];
  semantics: SemanticEntry[];
  totalEpisodes: number;
  totalSemantics: number;
}

// ── Hook event types (Claude Code lifecycle) ───────────────────────────────

export interface HookEvent {
  session_id: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
}

export interface HookResponse {
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
    permissionDecision?: "allow" | "deny" | "ask";
  };
}

// ── Consolidation types ────────────────────────────────────────────────────

export interface ConsolidationResult {
  promoted: SemanticInput[];
  updated: Array<{ id: string; value: string }>;
  decayed: string[];
  summary: string;
}

// ── Store configuration ────────────────────────────────────────────────────

export interface EngramConfig {
  dbPath: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  anthropicModel: string;
  openaiModel: string;
  maxEpisodesPerRetrieval: number;
  maxSemanticsPerRetrieval: number;
  salienceDecayRate: number;
  salienceAccessBoost: number;
  saliencePruneThreshold: number;
}

export const DEFAULT_CONFIG: EngramConfig = {
  dbPath: ".engram/memory.db",
  anthropicModel: "claude-haiku-4-5-20241022",
  openaiModel: "gpt-4o-mini",
  maxEpisodesPerRetrieval: 8,
  maxSemanticsPerRetrieval: 5,
  salienceDecayRate: 0.05,
  salienceAccessBoost: 0.15,
  saliencePruneThreshold: 0.1,
};
