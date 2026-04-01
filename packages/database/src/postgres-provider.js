"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var PostgresModule_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresModule = exports.POSTGRES_SQL = void 0;
exports.createPostgresProvider = createPostgresProvider;
const common_1 = require("@nestjs/common");
const postgres_1 = __importDefault(require("postgres"));
const require_env_1 = require("./require-env");
exports.POSTGRES_SQL = "POSTGRES_SQL";
function createPostgresProvider(options = {}) {
    const { defaultHost = "localhost", max = 10, idleTimeout = 20, connectTimeout = 10, prepare = false, } = options;
    return {
        provide: exports.POSTGRES_SQL,
        useFactory: () => {
            const host = process.env.POSTGRES_HOST ?? defaultHost;
            const port = Number(process.env.POSTGRES_PORT) || 5432;
            const database = process.env.POSTGRES_DB ?? "yoizen";
            const username = process.env.POSTGRES_USER ?? "yoizen";
            const password = (0, require_env_1.requireEnv)("POSTGRES_PASSWORD");
            return (0, postgres_1.default)({
                host,
                port,
                database,
                username,
                password,
                max,
                idle_timeout: idleTimeout,
                connect_timeout: connectTimeout,
                prepare,
            });
        },
    };
}
class SchemaInitializer {
    sql;
    statements;
    logger = new common_1.Logger(SchemaInitializer.name);
    constructor(sql, statements) {
        this.sql = sql;
        this.statements = statements;
    }
    async onModuleInit() {
        for (const statement of this.statements) {
            try {
                await this.sql.unsafe(statement);
            }
            catch (err) {
                this.logger.error("Schema init failed", err);
            }
        }
        this.logger.log("Schema initialization complete");
    }
    async onModuleDestroy() {
        await this.sql.end();
    }
}
let PostgresModule = PostgresModule_1 = class PostgresModule {
    static register(options = {}) {
        const { schemaSql = [], ...poolOptions } = options;
        const sqlProvider = createPostgresProvider(poolOptions);
        const providers = [sqlProvider];
        if (schemaSql.length > 0) {
            providers.push({
                provide: "SCHEMA_INITIALIZER",
                useFactory: (sql) => new SchemaInitializer(sql, schemaSql),
                inject: [exports.POSTGRES_SQL],
            });
        }
        return {
            module: PostgresModule_1,
            global: true,
            providers,
            exports: [sqlProvider],
        };
    }
};
exports.PostgresModule = PostgresModule;
exports.PostgresModule = PostgresModule = PostgresModule_1 = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({})
], PostgresModule);
//# sourceMappingURL=postgres-provider.js.map