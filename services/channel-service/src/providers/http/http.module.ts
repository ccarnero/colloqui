import { Module } from "@nestjs/common";
import { HttpProvider } from "./http.provider";

@Module({
  providers: [HttpProvider],
  exports: [HttpProvider],
})
export class HttpModule {}
