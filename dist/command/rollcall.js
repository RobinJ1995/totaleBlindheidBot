"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeRollcall = void 0;
const utils_1 = require("../utils");
const DAO_1 = __importDefault(require("../dao/DAO"));
const dao = new DAO_1.default();
const QUOTES = [
    "Are we rushin' in, or are we going' sneaky-beaky like?",
    "Bingo, bango, bongo, bish, bash, bosh!",
    "Easy peasy, lemon squeezy!",
    "Grab your gear and let's go!",
    "RUSH B DON'T STOP"
];
const executeRollcall = (bot, chat_id, reply_to_message_id) => {
    return dao.getRollcallPlayerUsernames(chat_id)
        .then((players) => bot.sendMessage(chat_id, `${(0, utils_1.pickRandom)(QUOTES)}\n${players.join(' ')}`, {
        reply_to_message_id,
        parse_mode: 'Markdown'
    }));
};
exports.executeRollcall = executeRollcall;
exports.default = (bot, msg) => {
    executeRollcall(bot, msg.chat.id, msg.message_id)
        .catch((err) => msg.reply(`*${err.toString()}*`));
};
