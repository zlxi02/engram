import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_CONFIG,
  type Episode,
  type EpisodeInput,
  type SemanticEntry,
  type SemanticInput,
  type EngramConfig,
} from "./types.js";

export class EngramStore {
  private db: Database.Database;
  private config: EngramConfig;

  constructor(config: Partial<EngramConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    const dir = dirname(this.config.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.config.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        goal TEXT NOT NULL,
        action TEXT NOT NULL,
        files TEXT NOT NULL DEFAULT '[]',
        outcome TEXT,
        error TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        salience REAL NOT NULL DEFAULT 1.0,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS semantic_entries (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source_episodes TEXT NOT NULL DEFAULT '[]',
        salience REAL NOT NULL DEFAULT 1.0,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id);
      CREATE INDEX IF NOT EXISTS idx_episodes_salience ON episodes(salience);
      CREATE INDEX IF NOT EXISTS idx_episodes_type ON episodes(type);
      CREATE INDEX IF NOT EXISTS idx_semantic_category ON semantic_entries(category);
      CREATE INDEX IF NOT EXISTS idx_semantic_key ON semantic_entries(key);
    `);
  }

  // ── Episode operations ───────────────────────────────────────────────────

  addEpisode(input: EpisodeInput): Episode {
    const now = new Date().toISOString();
    const episode: Episode = {
      id: `ep_${randomUUID().slice(0, 8)}`,
      sessionId: input.sessionId,
      timestamp: now,
      type: input.type,
      goal: input.goal,
      action: input.action,
      files: input.files ?? [],
      outcome: input.outcome ?? null,
      error: input.error ?? null,
      tags: input.tags ?? [],
      salience: 1.0,
      accessCount: 0,
      lastAccessed: now,
    };

    this.db
      .prepare(
        `INSERT INTO episodes (id, session_id, timestamp, type, goal, action, files, outcome, error, tags, salience, access_count, last_accessed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        episode.id,
        episode.sessionId,
        episode.timestamp,
        episode.type,
        episode.goal,
        episode.action,
        JSON.stringify(episode.files),
        episode.outcome,
        episode.error,
        JSON.stringify(episode.tags),
        episode.salience,
        episode.accessCount,
        episode.lastAccessed
      );

    return episode;
  }

  getEpisode(id: string): Episode | null {
    const row = this.db
      .prepare("SELECT * FROM episodes WHERE id = ?")
      .get(id) as EpisodeRow | undefined;
    return row ? this.rowToEpisode(row) : null;
  }

  getSessionEpisodes(sessionId: string): Episode[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM episodes WHERE session_id = ? ORDER BY timestamp ASC"
      )
      .all(sessionId) as EpisodeRow[];
    return rows.map((r) => this.rowToEpisode(r));
  }

  searchEpisodes(opts: {
    files?: string[];
    tags?: string[];
    keywords?: string[];
    minSalience?: number;
    limit?: number;
  }): Episode[] {
    let query = "SELECT * FROM episodes WHERE salience >= ?";
    const params: unknown[] = [opts.minSalience ?? this.config.saliencePruneThreshold];

    if (opts.files?.length) {
      const clauses = opts.files.map(() => "files LIKE ?");
      query += ` AND (${clauses.join(" OR ")})`;
      params.push(...opts.files.map((f) => `%${f}%`));
    }

    if (opts.tags?.length) {
      const clauses = opts.tags.map(() => "tags LIKE ?");
      query += ` AND (${clauses.join(" OR ")})`;
      params.push(...opts.tags.map((t) => `%${t}%`));
    }

    if (opts.keywords?.length) {
      const clauses = opts.keywords.map(
        () => "(goal LIKE ? OR action LIKE ? OR outcome LIKE ? OR error LIKE ?)"
      );
      query += ` AND (${clauses.join(" OR ")})`;
      for (const kw of opts.keywords) {
        params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
      }
    }

    query += ` ORDER BY salience DESC, timestamp DESC LIMIT ?`;
    params.push(opts.limit ?? this.config.maxEpisodesPerRetrieval);

    const rows = this.db.prepare(query).all(...params) as EpisodeRow[];

    // Boost salience on access
    const boostStmt = this.db.prepare(
      `UPDATE episodes SET access_count = access_count + 1,
       last_accessed = ?, salience = MIN(1.0, salience + ?) WHERE id = ?`
    );
    const now = new Date().toISOString();
    const boost = this.db.transaction(() => {
      for (const row of rows) {
        boostStmt.run(now, this.config.salienceAccessBoost, row.id);
      }
    });
    boost();

    return rows.map((r) => this.rowToEpisode(r));
  }

  getRecentEpisodes(limit: number = 10): Episode[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM episodes WHERE salience >= ?
         ORDER BY timestamp DESC LIMIT ?`
      )
      .all(this.config.saliencePruneThreshold, limit) as EpisodeRow[];
    return rows.map((r) => this.rowToEpisode(r));
  }

  // ── Semantic operations ──────────────────────────────────────────────────

  addSemantic(input: SemanticInput): SemanticEntry {
    const now = new Date().toISOString();
    const entry: SemanticEntry = {
      id: `sem_${randomUUID().slice(0, 8)}`,
      category: input.category,
      key: input.key,
      value: input.value,
      source_episodes: input.source_episodes ?? [],
      salience: 1.0,
      accessCount: 0,
      lastAccessed: now,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO semantic_entries (id, category, key, value, source_episodes, salience, access_count, last_accessed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.category,
        entry.key,
        entry.value,
        JSON.stringify(entry.source_episodes),
        entry.salience,
        entry.accessCount,
        entry.lastAccessed,
        entry.createdAt,
        entry.updatedAt
      );

    return entry;
  }

  upsertSemantic(input: SemanticInput): SemanticEntry {
    const existing = this.db
      .prepare(
        "SELECT * FROM semantic_entries WHERE category = ? AND key = ?"
      )
      .get(input.category, input.key) as SemanticRow | undefined;

    if (existing) {
      const now = new Date().toISOString();
      const sources = new Set([
        ...JSON.parse(existing.source_episodes as string),
        ...(input.source_episodes ?? []),
      ]);

      this.db
        .prepare(
          `UPDATE semantic_entries SET value = ?, source_episodes = ?,
           updated_at = ?, salience = MIN(1.0, salience + ?) WHERE id = ?`
        )
        .run(
          input.value,
          JSON.stringify([...sources]),
          now,
          this.config.salienceAccessBoost,
          existing.id
        );

      return this.rowToSemantic({
        ...existing,
        value: input.value,
        source_episodes: JSON.stringify([...sources]),
        updated_at: now,
      });
    }

    return this.addSemantic(input);
  }

  getAllSemantics(): SemanticEntry[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM semantic_entries WHERE salience >= ? ORDER BY category, key"
      )
      .all(this.config.saliencePruneThreshold) as SemanticRow[];
    return rows.map((r) => this.rowToSemantic(r));
  }

  searchSemantics(opts: {
    category?: string;
    keywords?: string[];
    limit?: number;
  }): SemanticEntry[] {
    let query = "SELECT * FROM semantic_entries WHERE salience >= ?";
    const params: unknown[] = [this.config.saliencePruneThreshold];

    if (opts.category) {
      query += " AND category = ?";
      params.push(opts.category);
    }

    if (opts.keywords?.length) {
      const clauses = opts.keywords.map(
        () => "(key LIKE ? OR value LIKE ?)"
      );
      query += ` AND (${clauses.join(" OR ")})`;
      for (const kw of opts.keywords) {
        params.push(`%${kw}%`, `%${kw}%`);
      }
    }

    query += ` ORDER BY salience DESC LIMIT ?`;
    params.push(opts.limit ?? this.config.maxSemanticsPerRetrieval);

    const rows = this.db.prepare(query).all(...params) as SemanticRow[];

    // Boost on access
    const boostStmt = this.db.prepare(
      `UPDATE semantic_entries SET access_count = access_count + 1,
       last_accessed = ?, salience = MIN(1.0, salience + ?) WHERE id = ?`
    );
    const now = new Date().toISOString();
    const boost = this.db.transaction(() => {
      for (const row of rows) {
        boostStmt.run(now, this.config.salienceAccessBoost, row.id);
      }
    });
    boost();

    return rows.map((r) => this.rowToSemantic(r));
  }

  updateSemantic(id: string, value: string): void {
    this.db
      .prepare(
        "UPDATE semantic_entries SET value = ?, updated_at = ? WHERE id = ?"
      )
      .run(value, new Date().toISOString(), id);
  }

  // ── Salience operations ──────────────────────────────────────────────────

  decayAll(): { decayedEpisodes: number; decayedSemantics: number; prunedEpisodes: number; prunedSemantics: number } {
    const rate = this.config.salienceDecayRate;
    const threshold = this.config.saliencePruneThreshold;

    this.db
      .prepare("UPDATE episodes SET salience = MAX(0, salience - ?)")
      .run(rate);
    this.db
      .prepare("UPDATE semantic_entries SET salience = MAX(0, salience - ?)")
      .run(rate);

    const decayedEpisodes = this.db.prepare("SELECT changes()").pluck().get() as number;

    const prunedEp = this.db
      .prepare("DELETE FROM episodes WHERE salience < ?")
      .run(threshold);
    const prunedSem = this.db
      .prepare("DELETE FROM semantic_entries WHERE salience < ?")
      .run(threshold);

    return {
      decayedEpisodes: this.db.prepare("SELECT COUNT(*) FROM episodes").pluck().get() as number,
      decayedSemantics: this.db.prepare("SELECT COUNT(*) FROM semantic_entries").pluck().get() as number,
      prunedEpisodes: prunedEp.changes,
      prunedSemantics: prunedSem.changes,
    };
  }

  decayEpisodes(ids: string[]): void {
    if (!ids.length) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db
      .prepare(
        `UPDATE episodes SET salience = MAX(0, salience - ?)
         WHERE id IN (${placeholders})`
      )
      .run(this.config.salienceDecayRate * 3, ...ids);
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  stats(): {
    totalEpisodes: number;
    totalSemantics: number;
    sessions: number;
    avgSalience: number;
  } {
    const totalEpisodes = this.db
      .prepare("SELECT COUNT(*) FROM episodes")
      .pluck()
      .get() as number;
    const totalSemantics = this.db
      .prepare("SELECT COUNT(*) FROM semantic_entries")
      .pluck()
      .get() as number;
    const sessions = this.db
      .prepare("SELECT COUNT(DISTINCT session_id) FROM episodes")
      .pluck()
      .get() as number;
    const avgSalience =
      (this.db
        .prepare("SELECT AVG(salience) FROM episodes")
        .pluck()
        .get() as number | null) ?? 0;

    return { totalEpisodes, totalSemantics, sessions, avgSalience };
  }

  close(): void {
    this.db.close();
  }

  // ── Row mapping ──────────────────────────────────────────────────────────

  private rowToEpisode(row: EpisodeRow): Episode {
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      type: row.type as Episode["type"],
      goal: row.goal,
      action: row.action,
      files: JSON.parse(row.files),
      outcome: row.outcome,
      error: row.error,
      tags: JSON.parse(row.tags),
      salience: row.salience,
      accessCount: row.access_count,
      lastAccessed: row.last_accessed,
    };
  }

  private rowToSemantic(row: SemanticRow): SemanticEntry {
    return {
      id: row.id,
      category: row.category as SemanticEntry["category"],
      key: row.key,
      value: row.value,
      source_episodes: JSON.parse(row.source_episodes),
      salience: row.salience,
      accessCount: row.access_count,
      lastAccessed: row.last_accessed,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ── Raw SQLite row types ───────────────────────────────────────────────────

interface EpisodeRow {
  id: string;
  session_id: string;
  timestamp: string;
  type: string;
  goal: string;
  action: string;
  files: string;
  outcome: string | null;
  error: string | null;
  tags: string;
  salience: number;
  access_count: number;
  last_accessed: string;
}

interface SemanticRow {
  id: string;
  category: string;
  key: string;
  value: string;
  source_episodes: string;
  salience: number;
  access_count: number;
  last_accessed: string;
  created_at: string;
  updated_at: string;
}
