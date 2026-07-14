/**
 * Verbose console logging helpers — adapted from
 * `sdk/samples/http-bridge/src/setup.ts`. Kept local to this demo tree on
 * purpose (see `demos/README.md`): demos are commercial showcases and do not
 * import runtime code across sibling trees, only the published
 * `@yoizen/platform-sdk` package.
 *
 * Every pipeline stage in this demo logs what it did with enough context to
 * debug a failed run without re-running it — nothing here fails silently.
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
