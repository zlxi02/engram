# Engram

Bio-inspired memory layer for Claude Code. Gives Claude persistent, structured, automatically-retrieved memory that survives across sessions and compactions.

Inspired by the brain's complementary learning systems: hippocampal episodic encoding, cue-based pattern completion, sleep consolidation, and active forgetting.

## Architecture

```
SESSION START
  → SessionStart hook loads semantic store + recent episodes
  → Injected as context Claude sees immediately

DURING SESSION
  → PreToolUse hook: before each tool call, searches memory for relevant history
  → PostToolUse hook: after each tool call, encodes action as structured episode
  → MCP tools available for explicit memory operations

SESSION END
  → SessionEnd hook runs consolidation ("sleep"):
    - Promotes patterns across episodes to semantic memory
    - Resolves contradictions in existing knowledge
    - Decays low-value episodes via salience scoring
```

## Components

| Component | File | Purpose |
|---|---|---|
| Store | `src/core/store.ts` | SQLite database for episodes + semantic entries |
| Encoder | `src/core/encoder.ts` | Classifies tool actions into structured episodes |
| Retrieval | `src/core/retrieval.ts` | Cue-based search and context formatting |
| Consolidation | `src/core/consolidation.ts` | Between-session pattern promotion and decay |
| Salience | `src/core/salience.ts` | Active forgetting via salience scoring |
| MCP Server | `src/mcp/server.ts` | Exposes memory tools for Claude Code + Cursor |
| Hooks | `src/hooks/` | Claude Code lifecycle integration |
| CLI | `src/cli.ts` | Manual memory operations |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure for Claude Code

Copy the hooks configuration into your Claude Code settings:

```bash
# The hooks.json file contains the configuration to add to your
# Claude Code settings (Settings > Hooks)
cat hooks.json
```

The `.mcp.json` file in the project root is automatically detected by Claude Code.

### 3. Configure for Cursor

The `.cursor/mcp.json` file is automatically detected by Cursor. Restart Cursor after setup.

### 4. (Optional) Set API key for smart consolidation

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Without an API key, consolidation uses heuristic pattern-matching instead of Claude Haiku.

## CLI Usage

```bash
# View memory status
npx tsx src/cli.ts status

# Search memory
npx tsx src/cli.ts search "auth jwt token"

# Run consolidation manually
npx tsx src/cli.ts consolidate

# Run salience decay
npx tsx src/cli.ts decay

# Clear all memory
npx tsx src/cli.ts reset --confirm
```

## MCP Tools

When configured, Claude has access to four memory tools:

- **engram_search** — Search past episodes and project knowledge
- **engram_store** — Explicitly save a decision or observation
- **engram_status** — View memory statistics
- **engram_consolidate** — Run consolidation manually

## How It Works

### Episodic Memory (Hippocampus analog)
Every tool call Claude makes gets encoded as a structured episode: type, goal, action, files, outcome, error, tags. Episodes are discrete, queryable records — not prose summaries.

### Cue-Based Retrieval (CA3 Pattern Completion analog)
Before each tool call, engram extracts cues (file paths, keywords) and searches the episode store. Matching history is injected into Claude's context automatically. Claude doesn't decide to remember — the system retrieves for it.

### Consolidation (Sleep Replay analog)
Between sessions, episodes are reviewed for patterns. Repeated patterns get promoted to semantic memory. Contradicted knowledge gets updated. Low-value episodes decay.

### Active Forgetting (GABA-mediated Suppression analog)
Every entry has a salience score that decays over time and increases on access. Entries below threshold get pruned. Memory stays lean and relevant.

## Example

**Session 1** — you debug a JWT verification failure. Claude reads `src/auth/verify.ts`, tries a fix, it fails, tries another, it works. Three episodes get written:

```
investigation  goal:"understand JWT failure"  files:[src/auth/verify.ts]  outcome:"iss claim not validated for third-party tokens"
attempt        goal:"fix JWT verification"    files:[src/auth/verify.ts]  outcome:"failure"  error:"tests still fail, wrong field"
success        goal:"fix JWT verification"    files:[src/auth/verify.ts]  outcome:"passed issuer option to jwt.verify()"  tags:[auth, jwt, bug]
```

At session end, consolidation promotes a semantic entry:

```
bug_pattern — JWT verification silently passes for third-party tokens when `iss` claim is
not explicitly validated. Fix: pass `issuer` option to `jwt.verify()`. See src/auth/verify.ts.
```

**Session 2** — two weeks later, you open `src/auth/verify.ts` for an unrelated change. Before Claude reads the file, PreToolUse fires, matches `src/auth/verify.ts` against the episode store, and injects this into Claude's context:

```
[Engram] Relevant history for src/auth/verify.ts:
  • bug_pattern: JWT verification silently passes for third-party tokens when `iss` claim
    is not explicitly validated. Fix: pass `issuer` option to jwt.verify().
  • success (3 sessions ago): fixed JWT verification — passed issuer option to jwt.verify()
```

Claude already knows about the bug before you say a word.
