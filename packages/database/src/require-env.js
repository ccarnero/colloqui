"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireEnv = requireEnv;
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} environment variable is required`);
    }
    return value;
}
//# sourceMappingURL=require-env.js.map