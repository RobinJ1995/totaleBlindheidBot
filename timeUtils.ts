import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';

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
const parseTime = (input: string, now: Date = new Date(), timezone: string = 'UTC'): Date | null => {
    input = input.trim().toLowerCase();

    // Numeric shortcuts rule: < 5 hours, >= 5 minutes
    if (/^\d+(\.\d+)?$/.test(input)) {
        const value: number = parseFloat(input);
        const unit: 'hours' | 'minutes' = value < 5 ? 'hours' : 'minutes';
        return DateTime.fromJSDate(now).plus({ [unit]: value }).toJSDate();
    }

    // Prepare reference date for chrono representing local time in UTC context
    // This allows chrono to correctly handle absolute times like "7pm"
    const nowInTz: DateTime = DateTime.fromJSDate(now).setZone(timezone);
    const referenceDate: Date = new Date(
        nowInTz.year,
        nowInTz.month - 1,
        nowInTz.day,
        nowInTz.hour,
        nowInTz.minute,
        nowInTz.second,
        nowInTz.millisecond
    );

    let results: chrono.ParsedResult[] = chrono.parse(input, referenceDate, { forwardDate: true });
    if (results.length === 0) {
        // Fallback: try with "in " prefix for purely relative durations like "3 hours" or "4.5h"
        // which chrono-node sometimes expects to be prefixed for parseDate/parse.
        results = chrono.parse('in ' + input, referenceDate, { forwardDate: true });
    }

    if (results.length === 0) return null;

    const result: chrono.ParsedResult = results[0];
    const components: chrono.ParsedComponents = result.start;

    // Use components to build the date in the correct timezone.
    // chrono-node's month is 1-indexed, same as Luxon's fromObject.
    const finalDate: DateTime = DateTime.fromObject({
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

export { parseTime };
