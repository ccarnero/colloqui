import { SetMetadata } from "@nestjs/common";

export const SCOPES_KEY = "requiredScopes";
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);
