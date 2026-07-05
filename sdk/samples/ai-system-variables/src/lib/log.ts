/**
 * Shared logging + small helpers for the ai-system-variables sample —
 * same conventions as ../../http-bridge/src/setup.ts (colored
 * [INFO]/[STEP]/[WARN]/[ERR] lines, requireEnv(), fail()).
 */

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const NC = "\x1b[0m";

export const log = (msg: string): void =>
  console.log(`${GREEN}[INFO]${NC}  ${msg}`);
export const step = (msg: string): void =>
  console.log(`${BLUE}[STEP]${NC}  ${msg}`);
export const warn = (msg: string): void =>
  console.log(`${YELLOW}[WARN]${NC}  ${msg}`);
export const err = (msg: string): void =>
  console.error(`${RED}[ERR]${NC}   ${msg}`);

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

export function fail(message: string): never {
  err(message);
  process.exit(1);
}

export function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
