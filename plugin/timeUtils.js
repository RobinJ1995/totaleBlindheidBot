const chrono = require('chrono-node');
const { DateTime } = require('luxon');

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
        return DateTime.fromJSDate(now).plus({ [unit]: value }).toJSDate();
    }

    // Prepare reference date for chrono representing local time in UTC context
    // This allows chrono to correctly handle absolute times like "7pm"
    const nowInTz = DateTime.fromJSDate(now).setZone(timezone);
    const referenceDate = new Date(Date.UTC(
        nowInTz.year,
        nowInTz.month - 1,
        nowInTz.day,
        nowInTz.hour,
        nowInTz.minute,
        nowInTz.second,
        nowInTz.millisecond
    ));

    let results = chrono.parse(input, referenceDate, { forwardDate: true });
    if (results.length === 0) {
        // Fallback: try with "in " prefix for purely relative durations like "3 hours" or "4.5h"
        // which chrono-node sometimes expects to be prefixed for parseDate/parse.
        results = chrono.parse('in ' + input, referenceDate, { forwardDate: true });
    }

    if (results.length === 0) return null;

    const result = results[0];
    const components = result.start;

    // Use components to build the date in the correct timezone.
    // chrono-node's month is 1-indexed, same as Luxon's fromObject.
    const finalDate = DateTime.fromObject({
        year: components.get('year'),
        month: components.get('month'),
        day: components.get('day'),
        hour: components.get('hour'),
        minute: components.get('minute'),
        second: components.get('second'),
        millisecond: components.get('millisecond')
    }, { zone: timezone });

    return finalDate.toJSDate();
};

module.exports = { parseTime };
