// Pure resolution of `inline`/`file` KB sources into upload-ready bytes.
// `url` sources are NOT handled here — they require a network fetch, see
// `fetch-kb-url-source.ts`. Kept separate so this function stays a pure,
// trivially-testable unit (no injected fetch to mock).

import type { KbSource } from "@yoizen/shared";
import { err, ok, type Result } from "../../../lib/result";
import type {
  KbBundle,
  ResolvedKbDocumentContent,
  ResolveKbSourceError,
} from "../domain/kb.interfaces";
import { computeSha256 } from "./compute-sha256";

/** Defense-in-depth per-file cap for `file:` bundle documents — the manifest
 * schema only caps `inline` content (`KB_INLINE_CONTENT_MAX_BYTES`); bundle
 * files travel out-of-band so provisioning-service enforces its own cap. */
export const KB_FILE_SOURCE_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB

export function resolveInlineOrFileSource(
  source: KbSource,
  bundle: KbBundle | undefined
): Result<ResolvedKbDocumentContent, ResolveKbSourceError> {
  if (source.type === "inline") {
    const bytes = Buffer.from(source.content, "utf8");
    return ok({
      sha256: computeSha256(bytes),
      bytes,
      uploadMode: "text",
    });
  }

  if (source.type === "file") {
    const bytes = bundle?.get(source.path);
    if (!bytes) {
      return err({
        kind: "file_not_in_bundle",
        message: `KB source file '${source.path}' was not found in the uploaded bundle`,
      });
    }
    if (bytes.length > KB_FILE_SOURCE_MAX_BYTES) {
      return err({
        kind: "file_too_large",
        message: `KB source file '${source.path}' is ${String(bytes.length)} bytes, over the ${String(KB_FILE_SOURCE_MAX_BYTES)}-byte cap`,
      });
    }
    const actualSha256 = computeSha256(bytes);
    if (actualSha256 !== source.sha256) {
      return err({
        kind: "file_checksum_mismatch",
        message: `KB source file '${source.path}' sha256 mismatch: manifest declares '${source.sha256}', bundle content hashes to '${actualSha256}'`,
      });
    }
    return ok({ sha256: actualSha256, bytes, uploadMode: "file" });
  }

  // Exhaustiveness guard — `url` sources are handled by fetch-kb-url-source.ts.
  return err({
    kind: "file_not_in_bundle",
    message: `resolveInlineOrFileSource does not handle source type '${(source as { type: string }).type}'`,
  });
}
