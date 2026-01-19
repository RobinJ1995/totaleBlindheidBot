"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const DAO_1 = __importDefault(require("../dao/DAO"));
const utils_1 = require("../utils");
const dao = new DAO_1.default();
exports.default = (bot, msg) => {
    const chat_id = msg.chat.id;
    dao.getScheduledRollcalls()
        .then((schedules) => {
        if (schedules[chat_id]) {
            return dao.removeScheduledRollcall(chat_id)
                .then(() => {
                msg.reply('Scheduled rollcall cancelled.');
            });
        }
        else {
            msg.reply('No rollcall scheduled for this group.');
            return;
        }
    })
        .catch((err) => msg.reply((0, utils_1.formatError)(err)));
};
