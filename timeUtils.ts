import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import tzSoft from 'timezone-soft';

// Minimal shape of a timezone-soft result; @types aren't published for it.
interface TimezoneResult {
    iana: string;
    [key: string]: any;
}

/**
 * Returns true if Luxon can actually use `zone` for scheduling.
 */
const isValidZone = (zone: string): boolean => DateTime.now().setZone(zone).isValid;

/**
 * Standard (non-DST) UTC offset of a zone, in minutes. Used to decide whether an
 * abbreviation is ambiguous: two zones are "the same" only if their standard
 * offset matches, so DST differences (e.g. Europe/Madrid vs Africa/Algiers) do
 * not count as ambiguity, while genuine differences (India vs Ireland for "IST")
 * do.
 */
const standardOffset = (zone: string): number => {
    for (const month of [1, 4, 7, 10]) {
        const dt: DateTime = DateTime.fromObject({ year: 2025, month, day: 15 }, { zone });
        if (dt.isValid && !dt.isInDST) return dt.offset;
    }
    return DateTime.fromObject({ year: 2025, month: 1, day: 15 }, { zone }).offset;
};

/**
 * Normalises a user-supplied timezone string into a canonical, Luxon-valid zone.
 *
 * Handles three families of input:
 * - Offsets ("UTC", "UTC+2", "GMT+2", "+02:00", "utc-5", "UTC+5:30") which are
 *   normalised to an intuitive ISO "±HH:MM" form. This form is accepted by both
 *   Luxon and JS Intl/toLocaleString (the scheduling path uses the latter),
 *   unlike "UTC+2"; offsets are parsed here rather than via timezone-soft, which
 *   maps them to confusing/incorrect IANA names (e.g. "UTC+2" -> "Etc/GMT-2",
 *   "GMT+2" -> "Etc/GMT+2" which is actually UTC-2).
 * - IANA names and city names ("Europe/Madrid", "europe/madrid", "Brussels"),
 *   resolved via timezone-soft and validated against Luxon.
 * - Abbreviations ("CET", "EST", "PST"), resolved via timezone-soft.
 *
 * @param {string} input Raw user input.
 * @returns {string|null} Canonical zone string, or null when unrecognised.
 */
const normalizeTimezone = (input: string): string | null => {
    const trimmed: string = input.trim();
    if (!trimmed) return null;

    // Offset forms: optional UTC/GMT prefix, optional sign, hours, optional minutes.
    const offsetMatch: RegExpMatchArray | null = trimmed.match(
        /^(?:utc|gmt)?\s*(?:([+-])\s*(\d{1,2})(?::?(\d{2}))?)?$/i
    );
    if (offsetMatch) {
        const [, sign, hoursStr, minutesStr] = offsetMatch;

        // Bare "UTC"/"GMT" (no sign/offset) -> UTC.
        if (!sign) {
            return 'UTC';
        }

        const hours: number = parseInt(hoursStr, 10);
        const minutes: number = minutesStr ? parseInt(minutesStr, 10) : 0;

        // "+0"/"UTC+00:00" and friends are just UTC.
        if (hours === 0 && minutes === 0) {
            return 'UTC';
        }

        // ISO "±HH:MM" form: accepted by both Luxon and JS Intl/toLocaleString.
        const candidate: string =
            `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        return isValidZone(candidate) ? candidate : null;
    }

    // Named / IANA / abbreviation forms.
    const results: TimezoneResult[] = tzSoft(trimmed);
    const valid: TimezoneResult[] = (results || []).filter(r => r.iana && isValidZone(r.iana));
    if (valid.length === 0) {
        return null;
    }

    const lowerInput: string = trimmed.toLowerCase();

    // (a) exact case-insensitive IANA match (e.g. "europe/madrid").
    const exact: TimezoneResult | undefined = valid.find(r => r.iana.toLowerCase() === lowerInput);
    if (exact) return exact.iana;

    // (b) IANA whose last path segment matches the input city (e.g. "Brussels" -> "Europe/Brussels").
    const bySegment: TimezoneResult | undefined = valid.find(r => {
        const segment: string = r.iana.split('/').pop()!.toLowerCase().replace(/_/g, ' ');
        return segment === lowerInput.replace(/_/g, ' ');
    });
    if (bySegment) return bySegment.iana;

    // (c) fall back to a bare abbreviation (e.g. "CET"). Reject it when it is
    // genuinely ambiguous, i.e. its candidate zones span more than one standard
    // UTC offset (e.g. "IST" -> India/Ireland/Israel, "EST" -> US/Australia).
    const distinctOffsets: Set<number> = new Set(valid.map(r => standardOffset(r.iana)));
    if (distinctOffsets.size > 1) {
        return null;
    }
    return valid[0].iana;
};

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

export { parseTime, normalizeTimezone };
