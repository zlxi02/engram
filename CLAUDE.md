# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # install dependencies
npm run build            # compile TypeScript → dist/
npm run dev              # run MCP server in watch mode (tsx watch)
npm run mcp              # run MCP server once
npm run status           # show memory stats
npm run consolidate      # run consolidation manually
npm test                 # run tests (tsx --test src/**/*.test.ts) — no test files exist yet
npx tsx src/cli.ts <cmd> # CLI: status | search <query> | consolidate | decay | reset --confirm
```

TypeScript is compiled to `dist/` with Node16 module resolution. Source runs directly via `tsx` without a build step during development.

## Architecture

Engram is a bio-inspired persistent memory layer for Claude Code. It intercepts the Claude Code session lifecycle via hooks and exposes memory tools via MCP.

### Two Memory Tiers (SQLite, `.engram/memory.db`)

**Episodes** — discrete records of individual tool calls: type (investigation/attempt/success/failure/decision/observation/plan), goal, action, files[], outcome, error, tags[], salience score. Written by `PostToolUse`, read by `PreToolUse`.

**Semantic entries** — consolidated project knowledge promoted from episode patterns: architecture, pattern, decision, convention, dependency, bug_pattern. Written by `SessionEnd` consolidation, read by `SessionStart`.

### Data Flow

```
SessionStart hook → loads semantic store + recent episodes → injects as additionalContext
     ↓
PreToolUse hook  → extracts cues (files, keywords) from tool input → retrieves matching episodes → injects context
     ↓
PostToolUse hook → encodes tool call as structured Episode → writes to SQLite
     ↓
SessionEnd hook  → runs Consolidator: promotes patterns to SemanticEntry, decays low-value episodes
```

### Core Modules (`src/core/`)

- **`types.ts`** — all shared types + `DEFAULT_CONFIG` (db path, salience params, model)
- **`store.ts`** — `EngramStore`: SQLite via `better-sqlite3`, episode/semantic CRUD, LIKE-based search, salience boost on access
- **`encoder.ts`** — `EpisodeEncoder`: maps tool names/inputs to structured `EpisodeInput` (e.g., `Read` → investigation, `Edit` → attempt/success)
- **`retrieval.ts`** — `CueRetrieval`: extracts file paths and keywords from tool input, searches store, formats results for context injection
- **`consolidation.ts`** — `Consolidator`: requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`; calls the configured LLM to review episodes and produce structured `promoted/updated/decayed` results. Without a key, consolidation is skipped (episodes still decay).
- **`salience.ts`** — `SalienceManager`: applies decay rate to all entries each session, targeted decay for specific IDs, prunes entries below threshold

### MCP Server (`src/mcp/server.ts`)

Exposes four tools: `engram_search`, `engram_store`, `engram_status`, `engram_consolidate`. Runs on stdio transport. Configured via `.mcp.json` (auto-detected by Claude Code).

### Hooks (`src/hooks/`)

Each hook reads JSON from stdin (Claude Code hook event format), performs its operation, and writes a JSON response to stdout. Hooks exit 0 silently on any error to avoid disrupting Claude Code. The `mcp__engram__*` tool prefix is skipped in PreToolUse/PostToolUse to avoid recursion.

### Configuration

`EngramConfig` defaults are in `types.ts`. Override via environment variables:
- `ENGRAM_DB_PATH` — path to SQLite database (default: `.engram/memory.db`, resolved relative to CWD)
- `ANTHROPIC_API_KEY` — enables Claude Haiku consolidation (required for semantic memory)
- `OPENAI_API_KEY` — alternative consolidation backend using `openaiModel` (default: `gpt-4o-mini`)
- `ENGRAM_SESSION_ID` — used by MCP server to namespace episodes

### Hook Registration

`hooks.json` contains the hook configuration to copy into Claude Code settings (Settings → Hooks). Hooks invoke source files directly via `npx tsx` — no build step required for hook execution.

## Validation Loop

Run this sequence after any change to verify the full pipeline is intact:

```bash
# 1. Store a known episode (proves SQLite write path works)
npx tsx src/cli.ts search "validation" || true   # baseline — should return nothing initially

# 2. Manually store an episode via MCP tool or seed script, then search for it
npx tsx src/cli.ts search "validation"           # should return the stored episode

# 3. Check db health and entry counts
npm run status                                   # must show non-zero episode/semantic counts

# 4. Run consolidation (requires ANTHROPIC_API_KEY or OPENAI_API_KEY)
npm run consolidate                              # must complete without error; no-op if no API key

# 5. Run unit tests
npm test                                         # all tests must pass
```

**What each step guards:**
- Step 1/2 — `EngramStore` LIKE-based search + `EpisodeEncoder` write path
- Step 3 — SQLite db is live and accessible at `ENGRAM_DB_PATH`
- Step 4 — `Consolidator` runs end-to-end (LLM path if API key set), salience/decay logic always runs
- Step 5 — unit-level regressions in core modules

If any step fails, the others above it in the data flow are suspect. Fix from the bottom up (store → retrieval → consolidation).
