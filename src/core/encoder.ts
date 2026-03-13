import { EngramStore } from "./store.js";
import type { Episode, EpisodeInput, EpisodeType } from "./types.js";

/**
 * Encodes tool actions from Claude Code into structured episodes.
 * Maps tool names + inputs + outputs to typed, tagged episode records.
 */
export class EpisodeEncoder {
  constructor(
    private store: EngramStore,
    private sessionId: string
  ) {}

  encodeToolUse(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolOutput: string | null,
    goal?: string
  ): Episode {
    const classification = classifyTool(toolName, toolInput, toolOutput);

    return this.store.addEpisode({
      sessionId: this.sessionId,
      type: classification.type,
      goal: goal ?? classification.inferredGoal,
      action: classification.action,
      files: classification.files,
      outcome: classification.outcome ?? undefined,
      error: classification.error ?? undefined,
      tags: classification.tags,
    });
  }

  encodeManual(input: EpisodeInput): Episode {
    return this.store.addEpisode({ ...input, sessionId: this.sessionId });
  }
}

// ── Tool classification ────────────────────────────────────────────────────

interface ToolClassification {
  type: EpisodeType;
  inferredGoal: string;
  action: string;
  files: string[];
  outcome: string | null;
  error: string | null;
  tags: string[];
}

function classifyTool(
  toolName: string,
  input: Record<string, unknown>,
  output: string | null
): ToolClassification {
  const hasError = output
    ? /error|failed|exception|traceback/i.test(output)
    : false;

  switch (toolName) {
    case "Read":
      return classifyRead(input, output);
    case "Edit":
    case "StrReplace":
    case "Write":
      return classifyWrite(toolName, input, output, hasError);
    case "Bash":
    case "Shell":
      return classifyShell(input, output, hasError);
    case "Glob":
    case "Grep":
    case "SemanticSearch":
      return classifySearch(toolName, input, output);
    default:
      return classifyGeneric(toolName, input, output, hasError);
  }
}

function classifyRead(
  input: Record<string, unknown>,
  output: string | null
): ToolClassification {
  const path = (input.file_path as string) ?? (input.path as string) ?? "unknown";
  return {
    type: "investigation",
    inferredGoal: `Reading ${basename(path)}`,
    action: `Read file: ${path}`,
    files: [path],
    outcome: output ? truncate(output, 200) : null,
    error: null,
    tags: extractTags(path, output),
  };
}

function classifyWrite(
  toolName: string,
  input: Record<string, unknown>,
  output: string | null,
  hasError: boolean
): ToolClassification {
  const path = (input.file_path as string) ?? (input.path as string) ?? "unknown";
  const action =
    toolName === "Write"
      ? `Created/overwrote: ${path}`
      : `Edited: ${path}`;

  return {
    type: hasError ? "failure" : "attempt",
    inferredGoal: `Modifying ${basename(path)}`,
    action,
    files: [path],
    outcome: hasError ? null : "File updated successfully",
    error: hasError && output ? truncate(output, 200) : null,
    tags: extractTags(path, output),
  };
}

function classifyShell(
  input: Record<string, unknown>,
  output: string | null,
  hasError: boolean
): ToolClassification {
  const command = (input.command as string) ?? "";
  const shortCmd = truncate(command, 100);

  const isTest = /test|jest|pytest|vitest|mocha/i.test(command);
  const isBuild = /build|compile|tsc|webpack|vite/i.test(command);
  const isInstall = /install|add|npm|yarn|pip/i.test(command);

  let type: EpisodeType = hasError ? "failure" : "attempt";
  let inferredGoal = `Running: ${shortCmd}`;

  if (isTest) {
    type = hasError ? "failure" : "success";
    inferredGoal = "Running tests";
  } else if (isBuild) {
    type = hasError ? "failure" : "success";
    inferredGoal = "Building project";
  } else if (isInstall) {
    type = "attempt";
    inferredGoal = "Installing dependencies";
  }

  const tags = ["shell"];
  if (isTest) tags.push("test");
  if (isBuild) tags.push("build");
  if (isInstall) tags.push("dependencies");

  return {
    type,
    inferredGoal,
    action: `Shell: ${shortCmd}`,
    files: [],
    outcome: !hasError && output ? truncate(output, 200) : null,
    error: hasError && output ? truncate(output, 300) : null,
    tags,
  };
}

function classifySearch(
  toolName: string,
  input: Record<string, unknown>,
  output: string | null
): ToolClassification {
  const pattern =
    (input.pattern as string) ??
    (input.glob_pattern as string) ??
    (input.query as string) ??
    "";

  return {
    type: "investigation",
    inferredGoal: `Searching: ${truncate(pattern, 80)}`,
    action: `${toolName}: ${truncate(pattern, 100)}`,
    files: [],
    outcome: output ? truncate(output, 200) : null,
    error: null,
    tags: ["search", toolName.toLowerCase()],
  };
}

function classifyGeneric(
  toolName: string,
  input: Record<string, unknown>,
  output: string | null,
  hasError: boolean
): ToolClassification {
  return {
    type: hasError ? "failure" : "observation",
    inferredGoal: `Using ${toolName}`,
    action: `${toolName}: ${truncate(JSON.stringify(input), 150)}`,
    files: [],
    outcome: !hasError && output ? truncate(output, 200) : null,
    error: hasError && output ? truncate(output, 200) : null,
    tags: [toolName.toLowerCase()],
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

function extractTags(path: string, output: string | null): string[] {
  const tags: string[] = [];
  const ext = path.split(".").pop()?.toLowerCase();

  if (ext) tags.push(ext);

  const dirParts = path.split("/").slice(0, -1);
  for (const part of dirParts) {
    if (
      ["src", "lib", "test", "tests", "components", "utils", "api", "hooks", "models", "routes", "services"].includes(
        part.toLowerCase()
      )
    ) {
      tags.push(part.toLowerCase());
    }
  }

  if (output) {
    if (/auth|login|token|jwt|session/i.test(output)) tags.push("auth");
    if (/database|sql|query|migration/i.test(output)) tags.push("database");
    if (/api|endpoint|route|handler/i.test(output)) tags.push("api");
    if (/test|spec|assert|expect/i.test(output)) tags.push("test");
    if (/error|bug|fix/i.test(output)) tags.push("bugfix");
  }

  return [...new Set(tags)];
}
