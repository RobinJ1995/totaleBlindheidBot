"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../../utils");
const DAO_1 = __importDefault(require("../../dao/DAO"));
const dao = new DAO_1.default();
exports.default = (bot, msg) => {
    dao.getRollcallPlayerUsernames(msg.chat.id)
        .then((players) => {
        if (players.length === 0) {
            msg.reply('No players in the rollcall.');
        }
        else {
            msg.reply(`Players in rollcall:\n${players.map((p) => {
                const match = p.match(/^\[(.*)\]\(tg:\/\/user\?id=\d+\)$/);
                const displayName = match ? match[1] : p;
                return (0, utils_1.escapeMarkdown)(displayName).replace('@', '@\u200B');
            }).map(p => `- ${p}`).join('\n')}`);
        }
    })
        .catch((err) => msg.reply((0, utils_1.formatError)(err)));
};
