import { EngramStore } from "./store.js";
import type { EngramConfig } from "./types.js";

/**
 * Salience management — the active forgetting analog.
 * Memories that are accessed frequently stay strong.
 * Memories that are never revisited decay and get pruned.
 */
export class SalienceManager {
  constructor(
    private store: EngramStore,
    private config: Pick<
      EngramConfig,
      "salienceDecayRate" | "salienceAccessBoost" | "saliencePruneThreshold"
    >
  ) {}

  /**
   * Run a full decay cycle. Typically called during consolidation (session end).
   * Reduces all salience scores and prunes entries below threshold.
   */
  decayCycle(): DecayReport {
    const before = this.store.stats();
    const result = this.store.decayAll();

    return {
      beforeEpisodes: before.totalEpisodes,
      beforeSemantics: before.totalSemantics,
      afterEpisodes: result.decayedEpisodes,
      afterSemantics: result.decayedSemantics,
      prunedEpisodes: result.prunedEpisodes,
      prunedSemantics: result.prunedSemantics,
    };
  }

  /**
   * Accelerated decay for specific episodes (e.g., those the consolidation
   * process identified as low-value).
   */
  targetedDecay(episodeIds: string[]): void {
    this.store.decayEpisodes(episodeIds);
  }
}

export interface DecayReport {
  beforeEpisodes: number;
  beforeSemantics: number;
  afterEpisodes: number;
  afterSemantics: number;
  prunedEpisodes: number;
  prunedSemantics: number;
}
