"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const timezone_soft_1 = __importDefault(require("timezone-soft"));
const DAO_1 = __importDefault(require("../dao/DAO"));
const utils_1 = require("../utils");
const dao = new DAO_1.default();
exports.default = (bot, msg) => {
    const argument = msg.command?.argument;
    const user_id = msg.from?.id || 0;
    if (!argument) {
        dao.getUserTimezone(user_id)
            .then((timezone) => msg.reply(`Your current timezone is ${timezone}`))
            .catch((err) => msg.reply((0, utils_1.formatError)(err)));
        return;
    }
    const results = (0, timezone_soft_1.default)(argument);
    if (!results || results.length === 0) {
        msg.reply(`Invalid timezone: ${argument}`);
        return;
    }
    // Prefer a result where the IANA name contains our input (e.g. "Dublin" -> "Europe/Dublin")
    const bestMatch = results.find(r => r.iana.toLowerCase().includes(argument.toLowerCase())) || results[0];
    const normalizedTz = bestMatch.iana;
    dao.setUserTimezone(user_id, normalizedTz)
        .then(() => msg.reply(`Your timezone has been set to ${normalizedTz}`))
        .catch((err) => msg.reply((0, utils_1.formatError)(err)));
};
