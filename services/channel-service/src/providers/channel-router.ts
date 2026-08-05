import { Injectable, NotFoundException } from "@nestjs/common";
import type { Channel, IChannelProvider } from "@yoizen/shared";
import { E2eTestsProvider } from "./e2e-tests/e2e-tests.provider";
import { HttpProvider } from "./http/http.provider";
import { ProviderRegistry } from "./meta/provider-registry";
import { TelegramProvider } from "./telegram/telegram.provider";

/**
 * Top-level channel router that aggregates all provider registries
 * (Meta, Telegram, Http, future ones) into a single lookup Map.
 *
 * All consumers (WebhooksController, EgressService, etc.) should
 * inject ChannelRouter instead of individual registries.
 */
@Injectable()
export class ChannelRouter {
  private readonly providers: Map<Channel, IChannelProvider>;

  constructor(
    metaRegistry: ProviderRegistry,
    telegram: TelegramProvider,
    http: HttpProvider,
    e2eTests: E2eTestsProvider
  ) {
    this.providers = new Map<Channel, IChannelProvider>();

    for (const channel of metaRegistry.channels()) {
      const provider = metaRegistry.get(channel);
      if (provider) {
        this.providers.set(channel, provider);
      }
    }

    this.providers.set(telegram.channel, telegram);
    this.providers.set(http.channel, http);
    this.providers.set(e2eTests.channel, e2eTests);
  }

  get(channel: Channel): IChannelProvider | undefined {
    return this.providers.get(channel);
  }

  getOrThrow(channel: Channel): IChannelProvider {
    const provider = this.providers.get(channel);
    if (!provider) {
      throw new NotFoundException(
        `No provider registered for channel: ${channel}`
      );
    }
    return provider;
  }
}
