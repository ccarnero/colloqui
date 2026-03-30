import { Injectable } from "@nestjs/common";
import type { IChannelProvider, Channel } from "@yoizen/shared";
import { WhatsAppProvider } from "./whatsapp/whatsapp.provider";
import { InstagramProvider } from "./instagram/instagram.provider";

@Injectable()
export class ProviderRegistry {
  private readonly providers: Map<Channel, IChannelProvider>;

  constructor(
    whatsapp: WhatsAppProvider,
    instagram: InstagramProvider,
  ) {
    this.providers = new Map<Channel, IChannelProvider>([
      ["whatsapp", whatsapp],
      ["instagram", instagram],
    ]);
  }

  get(channel: Channel): IChannelProvider | undefined {
    return this.providers.get(channel);
  }

  getOrThrow(channel: Channel): IChannelProvider {
    const provider = this.providers.get(channel);
    if (!provider) {
      throw new Error(`No provider registered for channel: ${channel}`);
    }
    return provider;
  }

  channels(): Channel[] {
    return [...this.providers.keys()];
  }
}
