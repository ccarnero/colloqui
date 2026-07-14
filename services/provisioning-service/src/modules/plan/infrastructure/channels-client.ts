// `IPlatformResourceClient` for channel-service's `GET /channels/accounts`.
//
// The live projection uses `channelComparable.fromLive` — the SAME contract
// the manifest's desired projection uses — so the two key sets always match
// and a matching channel converges to `noop`. Only `type` is comparable
// today; see `comparable-fields.ts` for the documented mapping scope.

import type { IPlatformResourceClient } from "../domain/platform-resource-client.interface";
import {
  type ChannelAccountDto,
  channelComparable,
} from "../lib/comparable-fields";
import { createHttpListResourceClient } from "./create-http-list-resource-client";

export function createChannelsClient(baseUrl: string): IPlatformResourceClient {
  return createHttpListResourceClient<ChannelAccountDto>({
    resourceKind: "channel",
    baseUrl,
    listPath: "/channels/accounts",
    getName: (item) => item.name,
    getExternalId: (item) => item.id,
    getFields: (item) => channelComparable.fromLive(item),
  });
}
