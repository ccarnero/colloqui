import { type DynamicModule } from "@nestjs/common";
import type { FactoryProvider } from "@nestjs/common";
import type { Sql } from "./types";
export declare const POSTGRES_SQL = "POSTGRES_SQL";
export interface PostgresPoolOptions {
    defaultHost?: string;
    max?: number;
    idleTimeout?: number;
    connectTimeout?: number;
    prepare?: boolean;
}
export interface PostgresModuleOptions extends PostgresPoolOptions {
    schemaSql?: string[];
}
export declare function createPostgresProvider(options?: PostgresPoolOptions): FactoryProvider<Sql>;
export declare class PostgresModule {
    static register(options?: PostgresModuleOptions): DynamicModule;
}
