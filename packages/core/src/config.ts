import path from "node:path";

const cwd = process.cwd();

export const CIEL_PATH = path.join(cwd, ".ciel");
export const CIEL_CONFIG_PATH = path.join(CIEL_PATH, "config.json");
export const SESSION_DIR_PATH = path.join(CIEL_PATH, "sessions");
export const MEMORY_DIR_PATH = path.join(CIEL_PATH, "memory");
export const WORKSPACE_DIR_PATH = path.join(CIEL_PATH, "workspace");
export const AGENT_DIR_PATH = path.join(CIEL_PATH, "agent");
