import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { EngramStore } from "./store.js";
import { SalienceManager } from "./salience.js";
import type {
  ConsolidationResult,
  EngramConfig,
} from "./types.js";

/**
 * Consolidation — the "sleep replay" analog.
 * Runs between sessions: reviews new episodes, promotes patterns
 * to semantic memory, resolves contradictions, decays noise.
 */
export class Consolidator {
  private store: EngramStore;
  private salience: SalienceManager;
  private config: EngramConfig;

  constructor(store: EngramStore, config: EngramConfig) {
    this.store = store;
    this.salience = new SalienceManager(store, config);
    this.config = config;
  }

  async consolidate(sessionId?: string): Promise<ConsolidationResult> {
    const episodes = sessionId
      ? this.store.getSessionEpisodes(sessionId)
      : this.store.getRecentEpisodes(30);

    if (!episodes.length) {
      return { promoted: [], updated: [], decayed: [], summary: "No episodes to consolidate." };
    }

    const existingKnowledge = this.store.getAllSemantics();

    if (this.config.anthropicApiKey) {
      return this.consolidateWithApi(episodes, existingKnowledge);
    }

    if (this.config.openaiApiKey) {
      return this.consolidateWithOpenAi(episodes, existingKnowledge);
    }

    this.salience.decayCycle();
    return { promoted: [], updated: [], decayed: [], summary: "No API key configured — skipping semantic consolidation. Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable." };
  }

  /**
   * API-powered consolidation using Claude Haiku.
   * Reviews episodes + existing knowledge, returns structured updates.
   */
  private async consolidateWithApi(
    episodes: Array<{ id: string; type: string; goal: string; action: string; files: string[]; outcome: string | null; error: string | null; tags: string[] }>,
    existingKnowledge: Array<{ id: string; category: string; key: string; value: string }>
  ): Promise<ConsolidationResult> {
    const client = new Anthropic({ apiKey: this.config.anthropicApiKey });

    const episodeSummary = episodes
      .map(
        (ep) =>
          `[${ep.type}] ${ep.action}${ep.outcome ? ` → ${ep.outcome}` : ""}${ep.error ? ` ⚠ ${ep.error}` : ""} (files: ${ep.files.join(", ") || "none"}, tags: ${ep.tags.join(", ")})`
      )
      .join("\n");

    const knowledgeSummary = existingKnowledge.length
      ? existingKnowledge
          .map((k) => `[${k.category}] ${k.key}: ${k.value}`)
          .join("\n")
      : "(no existing knowledge)";

    const response = await client.messages.create({
      model: this.config.consolidationModel,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a memory consolidation system. Review these work episodes and existing project knowledge. Respond with ONLY valid JSON matching the schema below.

## Recent Episodes
${episodeSummary}

## Existing Knowledge
${knowledgeSummary}

## Your Task
Analyze the episodes and produce a JSON object with these fields:

{
  "promoted": [
    {"category": "architecture|pattern|decision|convention|dependency|bug_pattern", "key": "short_name", "value": "description of the knowledge"}
  ],
  "updated": [
    {"id": "existing_semantic_id", "value": "corrected description"}
  ],
  "decayed": ["episode_id_1", "episode_id_2"],
  "summary": "One sentence describing what was consolidated"
}

Rules:
- "promoted": patterns that appear across multiple episodes or represent important project knowledge. Only promote if genuinely reusable.
- "updated": existing knowledge entries that are contradicted by new episodes. Use the exact id from existing knowledge.
- "decayed": episode IDs that are low-value (irrelevant file reads, redundant investigations). Don't decay failures — those are valuable.
- Keep it conservative. Only promote clear patterns.

Respond with ONLY the JSON object, no markdown fences or explanation.`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    try {
      const result = JSON.parse(text) as ConsolidationResult;
      return this.applyConsolidation(result);
    } catch {
      return {
        promoted: [],
        updated: [],
        decayed: [],
        summary: `Consolidation parse failed. Raw: ${text.slice(0, 200)}`,
      };
    }
  }

  /**
   * OpenAI-powered consolidation. Same prompt/schema as the Anthropic path.
   */
  private async consolidateWithOpenAi(
    episodes: Array<{ id: string; type: string; goal: string; action: string; files: string[]; outcome: string | null; error: string | null; tags: string[] }>,
    existingKnowledge: Array<{ id: string; category: string; key: string; value: string }>
  ): Promise<ConsolidationResult> {
    const client = new OpenAI({ apiKey: this.config.openaiApiKey });

    const episodeSummary = episodes
      .map(
        (ep) =>
          `[${ep.type}] ${ep.action}${ep.outcome ? ` → ${ep.outcome}` : ""}${ep.error ? ` ⚠ ${ep.error}` : ""} (files: ${ep.files.join(", ") || "none"}, tags: ${ep.tags.join(", ")})`
      )
      .join("\n");

    const knowledgeSummary = existingKnowledge.length
      ? existingKnowledge
          .map((k) => `[${k.category}] ${k.key}: ${k.value}`)
          .join("\n")
      : "(no existing knowledge)";

    const response = await client.chat.completions.create({
      model: this.config.openaiModel,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a memory consolidation system. Review these work episodes and existing project knowledge. Respond with ONLY valid JSON matching the schema below.

## Recent Episodes
${episodeSummary}

## Existing Knowledge
${knowledgeSummary}

## Your Task
Analyze the episodes and produce a JSON object with these fields:

{
  "promoted": [
    {"category": "architecture|pattern|decision|convention|dependency|bug_pattern", "key": "short_name", "value": "description of the knowledge"}
  ],
  "updated": [
    {"id": "existing_semantic_id", "value": "corrected description"}
  ],
  "decayed": ["episode_id_1", "episode_id_2"],
  "summary": "One sentence describing what was consolidated"
}

Rules:
- "promoted": patterns that appear across multiple episodes or represent important project knowledge. Only promote if genuinely reusable.
- "updated": existing knowledge entries that are contradicted by new episodes. Use the exact id from existing knowledge.
- "decayed": episode IDs that are low-value (irrelevant file reads, redundant investigations). Don't decay failures — those are valuable.
- Keep it conservative. Only promote clear patterns.

Respond with ONLY the JSON object, no markdown fences or explanation.`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "";

    try {
      const result = JSON.parse(text) as ConsolidationResult;
      return this.applyConsolidation(result);
    } catch {
      return {
        promoted: [],
        updated: [],
        decayed: [],
        summary: `Consolidation parse failed. Raw: ${text.slice(0, 200)}`,
      };
    }
  }

  /**
   * Apply consolidation results to the store.
   */
  private applyConsolidation(result: ConsolidationResult): ConsolidationResult {
    for (const entry of result.promoted) {
      this.store.upsertSemantic(entry);
    }

    for (const update of result.updated) {
      this.store.updateSemantic(update.id, update.value);
    }

    if (result.decayed.length) {
      this.salience.targetedDecay(result.decayed);
    }

    this.salience.decayCycle();

    return result;
  }
}
