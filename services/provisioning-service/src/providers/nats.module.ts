// Single owner of the NATS connection + JetStream client/manager for the
// whole service. Declared `@Global` and exporting the three tokens so every
// module (ApplyModule's audit publisher, KbModule's Object Store blob store)
// shares ONE NATS connection instead of each re-declaring the providers —
// which would open a SEPARATE connection per declaring module at boot.
//
// Regression origin (T06): KbModule initially re-declared `natsProvider`/
// `jetStreamProvider`/`jetStreamManagerProvider` alongside ApplyModule's own
// copies, so a fresh pod opened duplicate NATS connections at startup — a
// boot-time side effect the old (T05) revision never had, and one that
// mocked module-compile tests could not surface. Consolidating here removes
// that duplication and the associated boot risk.

import { Global, Module } from "@nestjs/common";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  jetStreamManagerProvider,
  jetStreamProvider,
  NATS_CONNECTION,
  natsProvider,
} from "./nats.provider";

@Global()
@Module({
  providers: [natsProvider, jetStreamManagerProvider, jetStreamProvider],
  exports: [NATS_CONNECTION, JETSTREAM, JETSTREAM_MANAGER],
})
export class NatsModule {}
