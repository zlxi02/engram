# Engram

AI coding assistants are stateless. Every session starts from zero — no memory of what you were working on, what you tried, what failed, why you made certain decisions. This is a memory layer that changes that.

## The idea

Human memory has two tiers: episodic (discrete events) and semantic (consolidated knowledge). Episodic memory captures what happened; semantic memory captures what it means. Engram applies the same structure to Claude Code sessions.

It also models salience decay — the biological tendency to forget things you don't use. Memories that get accessed frequently stay alive; memories that go untouched fade. This keeps the context window clean and relevant instead of filling up with stale history.

## How it works

Engram hooks into the Claude Code session lifecycle. It watches every tool call — file reads, edits, shell commands — and encodes each one as a typed episode: what was the goal, what action was taken, what files were involved, did it succeed or fail.

At session end, an LLM reviews the episode log and promotes recurring patterns to a durable semantic store: architectural decisions, conventions, known bug patterns, dependencies. The next session loads this distilled knowledge automatically, before you type anything.

The two tiers live in a local SQLite database. Nothing leaves your machine unless you configure a remote model for consolidation.

```
SessionStart  →  load semantic store + recent episodes → inject as context
PreToolUse    →  extract cues from tool input → retrieve matching episodes → inject context
PostToolUse   →  encode tool call as episode → write to SQLite
SessionEnd    →  LLM consolidation: promote patterns, decay low-value episodes
```

## Example

Say you spend a session tracking down a bug — a JWT verification failure that only happens when tokens are issued by a third-party provider. You read several files, run some shell commands, hit a dead end, then find the fix: the issuer field wasn't being validated.

Engram records each step as an episode. At session end, consolidation promotes a semantic entry something like:

> **bug_pattern** — JWT verification fails for third-party tokens when `iss` claim is not explicitly validated. Fix: pass `issuer` option to `jwt.verify()`. Affected files: `src/auth/verify.ts`.

Two weeks later, in a new session, you open `src/auth/verify.ts` for an unrelated change. Before you type anything, Engram injects that entry as context. Claude already knows about the issuer bug.

The same mechanism works for decisions ("we use `zod` for all external input validation, not `joi`"), conventions ("database migrations live in `db/migrations/` and must be reversible"), and recurring failures ("this test flakes when the SQLite file is open in another process").

## Setup

```bash
npm install
```

Copy the hooks from `hooks.json` into Claude Code settings (Settings → Hooks). The `.mcp.json` file in the project root is auto-detected by Claude Code — no additional configuration needed.

Set an API key for LLM consolidation (optional — without it, episodes are stored but not promoted to semantic memory):

```bash
export ANTHROPIC_API_KEY=...   # uses claude-haiku-4-5
# or
export OPENAI_API_KEY=...      # uses gpt-4o-mini
```

## CLI

```bash
npx tsx src/cli.ts status             # memory stats
npx tsx src/cli.ts search <query>     # search episodes and semantic store
npx tsx src/cli.ts consolidate        # run consolidation manually
npx tsx src/cli.ts decay              # apply salience decay
npx tsx src/cli.ts reset --confirm    # clear all memory
```

## MCP tools

When configured, Claude has access to four memory tools: `engram_search`, `engram_store`, `engram_status`, `engram_consolidate`.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `.engram/memory.db` | Path to SQLite database |
| `ANTHROPIC_API_KEY` | — | Enables Claude Haiku consolidation |
| `OPENAI_API_KEY` | — | Alternative: OpenAI consolidation backend |
| `ENGRAM_SESSION_ID` | — | Session namespace (set automatically by MCP server) |
