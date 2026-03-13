import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CONFIG, type EngramConfig } from "./types.js";

interface EngramConfigFile {
  anthropicModel?: string;
  openaiModel?: string;
}

/**
 * Load EngramConfig by merging (lowest → highest priority):
 *   DEFAULT_CONFIG < .engram/config.json < environment variables
 */
export function loadEngramConfig(): EngramConfig {
  const fileConfig = readConfigFile();

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    dbPath: resolve(process.env.ENGRAM_DB_PATH ?? DEFAULT_CONFIG.dbPath),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  };
}

function readConfigFile(): Partial<EngramConfigFile> {
  try {
    const raw = readFileSync(resolve(".engram/config.json"), "utf8");
    return JSON.parse(raw) as EngramConfigFile;
  } catch {
    return {};
  }
}
