import { Module } from "@nestjs/common";
import { E2eTestsProvider } from "./e2e-tests.provider";

@Module({
  providers: [E2eTestsProvider],
  exports: [E2eTestsProvider],
})
export class E2eTestsModule {}
