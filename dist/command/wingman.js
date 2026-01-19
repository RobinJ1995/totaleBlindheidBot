"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../utils");
const DAO_1 = __importDefault(require("../dao/DAO"));
const dao = new DAO_1.default();
const QUOTES = [
    "Be my wingman!",
    "Be my wingman yo!",
    "Let's score some!",
    "I'm a single pringle and ready to mingle!"
];
exports.default = (bot, msg) => {
    dao.getRollcallPlayerUsernames(msg.chat?.id || 0)
        .then((players) => msg.reply(`${(0, utils_1.pickRandom)(QUOTES)}\n${players.join(' ')}`))
        .catch((err) => msg.reply(`*${err.toString()}*`));
};
