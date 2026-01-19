"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTime = void 0;
const chrono = __importStar(require("chrono-node"));
const luxon_1 = require("luxon");
/**
 * Parses a time string into a Date object.
 * Handles:
 * - Relative times: "3 hours", "1 minute", "4.5h"
 * - Absolute times: "7pm", "17:00"
 * - ISO8601 timestamps
 * - Numeric shortcuts: < 5 means hours from now, >= 5 means minutes from now
 *
 * @param {string} input The time string to parse
 * @param {Date} now Reference date (default: now)
 * @param {string} timezone User's timezone (default: UTC)
 * @returns {Date|null} Parsed Date object or null if invalid
 */
const parseTime = (input, now = new Date(), timezone = 'UTC') => {
    input = input.trim().toLowerCase();
    // Numeric shortcuts rule: < 5 hours, >= 5 minutes
    if (/^\d+(\.\d+)?$/.test(input)) {
        const value = parseFloat(input);
        const unit = value < 5 ? 'hours' : 'minutes';
        return luxon_1.DateTime.fromJSDate(now).plus({ [unit]: value }).toJSDate();
    }
    // Prepare reference date for chrono representing local time in UTC context
    // This allows chrono to correctly handle absolute times like "7pm"
    const nowInTz = luxon_1.DateTime.fromJSDate(now).setZone(timezone);
    const referenceDate = new Date(nowInTz.year, nowInTz.month - 1, nowInTz.day, nowInTz.hour, nowInTz.minute, nowInTz.second, nowInTz.millisecond);
    let results = chrono.parse(input, referenceDate, { forwardDate: true });
    if (results.length === 0) {
        // Fallback: try with "in " prefix for purely relative durations like "3 hours" or "4.5h"
        // which chrono-node sometimes expects to be prefixed for parseDate/parse.
        results = chrono.parse('in ' + input, referenceDate, { forwardDate: true });
    }
    if (results.length === 0)
        return null;
    const result = results[0];
    const components = result.start;
    // Use components to build the date in the correct timezone.
    // chrono-node's month is 1-indexed, same as Luxon's fromObject.
    const finalDate = luxon_1.DateTime.fromObject({
        year: components.get('year') ?? undefined,
        month: components.get('month') ?? undefined,
        day: components.get('day') ?? undefined,
        hour: components.get('hour') ?? undefined,
        minute: components.get('minute') ?? undefined,
        second: components.get('second') ?? undefined,
        millisecond: components.get('millisecond') ?? undefined
    }, { zone: timezone });
    return finalDate.toJSDate();
};
exports.parseTime = parseTime;
