"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const DAO_1 = __importDefault(require("../dao/DAO"));
const utils_1 = require("../utils");
const dao = new DAO_1.default();
exports.default = (bot, msg) => {
    const arg = msg.command?.argument?.toLowerCase();
    if (arg !== 'on' && arg !== 'off') {
        msg.reply('Please specify "on" or "off" to enable or disable Steam updates for this chat.');
        return;
    }
    const enabled = arg === 'on';
    dao.setChatSettings(msg.chat.id, { steam_updates: enabled })
        .then(() => {
        msg.reply(`Steam updates for this chat have been turned ${arg}.`);
    })
        .catch((err) => msg.reply((0, utils_1.formatError)(err)));
};
