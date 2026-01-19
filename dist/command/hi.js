"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = (bot, msg) => {
    const who = msg.from?.first_name || msg.from?.username || 'stranger';
    msg.reply(`Hello to you too, ${who}!`);
};
