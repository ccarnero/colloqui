// Pure sha256 helper shared by every KB source type (inline content hash,
// file-bundle declared-checksum verification, url-fetch content hash).

import { createHash } from "node:crypto";

export function computeSha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
