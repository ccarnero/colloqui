/**
 * Verbose console logging helpers — copied from
 * `../../src/lib/logging.ts` (NOT imported across trees: `priority-scorer`
 * is its own package under `hosted-services-api` conventions, built into a
 * standalone container image, so it cannot reach outside its own directory
 * at build time). Every request handler in this service logs what it did —
 * nothing fails silently.
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
