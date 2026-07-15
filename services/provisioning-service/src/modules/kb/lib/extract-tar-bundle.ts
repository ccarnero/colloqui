// Minimal, dependency-free USTAR/GNU-compatible tar reader for T06's `file:`
// KB content bundle (SPEC.md decision 6). Pure function: no filesystem
// access, no side effects — every entry is read straight from the in-memory
// `buffer` into a `path -> bytes` map. There is no `tar` package in this
// service's dependency tree (or anywhere in the workspace lockfile), so this
// reads the well-documented 512-byte-block USTAR header format directly
// rather than adding a new third-party dependency for a narrow, fully
// in-our-control format (the e2e script controls how the bundle is built).
//
// Safety (unit-tested): rejects absolute paths and any entry whose path
// normalizes to escape the bundle root (`../` traversal), and enforces both
// a per-entry and a total-bundle byte cap — a hostile or malformed bundle
// can never write outside the returned map's flat namespace or exhaust
// memory unbounded.

import { err, ok, type Result } from "../../../lib/result";

const BLOCK_SIZE = 512;

export interface ExtractTarBundleOptions {
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

export type ExtractTarBundleErrorKind =
  | "invalid_header"
  | "path_traversal"
  | "absolute_path"
  | "entry_too_large"
  | "bundle_too_large";

export interface ExtractTarBundleError {
  readonly kind: ExtractTarBundleErrorKind;
  readonly entry?: string;
  readonly message: string;
}

export type ExtractedTarBundle = ReadonlyMap<string, Buffer>;

export function extractTarBundle(
  buffer: Buffer,
  options: ExtractTarBundleOptions
): Result<ExtractedTarBundle, ExtractTarBundleError> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  let totalBytes = 0;

  while (offset + BLOCK_SIZE <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK_SIZE);
    if (isZeroBlock(header)) {
      // End-of-archive marker (one or two all-zero blocks) — stop reading.
      break;
    }

    const nameField = readString(header, 0, 100);
    const prefixField = readString(header, 345, 155);
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const sizeField = readString(header, 124, 12);
    const size = parseOctalSize(sizeField);

    if (size === null) {
      return err({
        kind: "invalid_header",
        message: `unreadable tar size field at byte offset ${String(offset)}`,
      });
    }

    const rawName = prefixField ? `${prefixField}/${nameField}` : nameField;
    offset += BLOCK_SIZE;

    // Directory ('5') and other non-regular-file entries ('0'/'\0' is
    // "regular file" in both plain USTAR and GNU tar): skip past their data
    // blocks (normally 0 for directories) without extracting them.
    if (typeflag !== "0" && typeflag !== "\0") {
      offset += alignToBlock(size);
      continue;
    }

    if (rawName.length === 0) {
      // Defensive: a regular-file entry with no name is not a real file.
      offset += alignToBlock(size);
      continue;
    }

    if (rawName.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rawName)) {
      return err({
        kind: "absolute_path",
        entry: rawName,
        message: `tar entry has an absolute path: '${rawName}'`,
      });
    }

    const normalized = normalizeTarPath(rawName);
    if (normalized === null) {
      return err({
        kind: "path_traversal",
        entry: rawName,
        message: `tar entry escapes the bundle root: '${rawName}'`,
      });
    }

    if (size > options.maxEntryBytes) {
      return err({
        kind: "entry_too_large",
        entry: rawName,
        message: `tar entry '${rawName}' is ${String(size)} bytes, over the ${String(options.maxEntryBytes)}-byte per-entry cap`,
      });
    }

    totalBytes += size;
    if (totalBytes > options.maxTotalBytes) {
      return err({
        kind: "bundle_too_large",
        entry: rawName,
        message: `bundle total size exceeds the ${String(options.maxTotalBytes)}-byte cap`,
      });
    }

    const dataEnd = offset + size;
    if (dataEnd > buffer.length) {
      return err({
        kind: "invalid_header",
        entry: rawName,
        message: `tar entry '${rawName}' data runs past the end of the archive`,
      });
    }

    files.set(normalized, Buffer.from(buffer.subarray(offset, dataEnd)));
    offset += alignToBlock(size);
  }

  return ok(files);
}

function isZeroBlock(block: Buffer): boolean {
  for (let i = 0; i < block.length; i++) {
    if (block[i] !== 0) {
      return false;
    }
  }
  return true;
}

function readString(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const nulIndex = slice.indexOf(0);
  const trimmed = nulIndex === -1 ? slice : slice.subarray(0, nulIndex);
  return trimmed.toString("utf8").trim();
}

function parseOctalSize(field: string): number | null {
  const trimmed = field.trim();
  if (trimmed === "") {
    return 0;
  }
  const value = Number.parseInt(trimmed, 8);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function alignToBlock(size: number): number {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? size : size + (BLOCK_SIZE - remainder);
}

/**
 * Resolves `.`/`..` segments against a virtual bundle root. Returns `null`
 * when the entry would escape that root (a `..` with nothing left to pop) —
 * the caller treats that as a rejected, unsafe entry.
 */
function normalizeTarPath(rawName: string): string | null {
  const segments = rawName
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "..") {
      if (resolved.length === 0) {
        return null;
      }
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}
