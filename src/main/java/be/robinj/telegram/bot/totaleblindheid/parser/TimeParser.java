package be.robinj.telegram.bot.totaleblindheid.parser;

import be.robinj.telegram.bot.totaleblindheid.error.ParserError;
import com.google.common.base.Preconditions;
import com.google.common.collect.ImmutableSet;

import java.time.Duration;
import java.time.Instant;

public class TimeParser {

	public Instant parse(final String str) throws ParserError {
		try {
			final String[] splitByWhitespace = str.split("\\s+");

			if (splitByWhitespace.length == 2
				&& splitByWhitespace[0].length() > 0
				&& splitByWhitespace[0].chars().allMatch(Character::isDigit)
				&& splitByWhitespace[1].length() > 1
				&& splitByWhitespace[1].chars().allMatch(Character::isAlphabetic)) {
				final int number = Integer.parseInt(splitByWhitespace[0]);
				final String unit = splitByWhitespace[1].toLowerCase();

				if (ImmutableSet.of("minute", "minutes", "minuut", "minuten")
					.stream()
					.anyMatch(unit::equals)) {
					return Instant.now().plus(Duration.ofMinutes(number));
				} else if (ImmutableSet.of("hour", "hours", "uur")
					.stream()
					.anyMatch(unit::equals)) {
					return Instant.now().plus(Duration.ofHours(number));
				}

				throw new ParserError(String.format("Unknown unit: %s", unit));
			}

			return Instant.parse(str);
		} catch (final Exception ex) {
			throw new ParserError(ex);
		}
	}
}
