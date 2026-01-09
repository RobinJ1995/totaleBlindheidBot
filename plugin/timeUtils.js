const parseTime = (input, now = new Date()) => {
    input = input.trim().toLowerCase();

    // ISO 8601
    if (input.match(/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/)) {
        const date = new Date(input);
        if (!isNaN(date.getTime())) {
            return date;
        }
    }

    // Relative with units: 3 hours, 1 minute, 4.5h, 10m
    const relativeMatch = input.match(/^(\d+(\.\d+)?)\s*(h(ours?)?|m(in(utes?)?)?)$/);
    if (relativeMatch) {
        const value = parseFloat(relativeMatch[1]);
        const unit = relativeMatch[3][0]; // 'h' or 'm'
        const ms = value * (unit === 'h' ? 3600000 : 60000);
        return new Date(now.getTime() + ms);
    }

    // Just a number
    if (input.match(/^\d+(\.\d+)?$/)) {
        const value = parseFloat(input);
        const ms = value < 5 ? value * 3600000 : value * 60000;
        return new Date(now.getTime() + ms);
    }

    // Absolute time: 7pm, 17:00, 17:00:00
    const absoluteMatch = input.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/);
    if (absoluteMatch) {
        let hours = parseInt(absoluteMatch[1]);
        const minutes = parseInt(absoluteMatch[2] || '0');
        const seconds = parseInt(absoluteMatch[3] || '0');
        const ampm = absoluteMatch[4];

        if (ampm === 'pm' && hours < 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;

        const date = new Date(now);
        date.setHours(hours, minutes, seconds, 0);

        // If time is in the past, assume it's for tomorrow
        if (date.getTime() <= now.getTime()) {
            date.setDate(date.getDate() + 1);
        }
        return date;
    }

    return null;
};

module.exports = { parseTime };
