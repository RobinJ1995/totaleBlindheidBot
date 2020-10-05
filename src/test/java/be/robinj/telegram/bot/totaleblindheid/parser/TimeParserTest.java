package be.robinj.telegram.bot.totaleblindheid.parser;

import com.google.common.collect.ImmutableMap;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.function.Predicate;

import static java.lang.String.format;
import static java.time.temporal.ChronoUnit.*;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class TimeParserTest {

	@Test
	void parseTime() {
		final var parser = new TimeParser();

		ImmutableMap.<String, Predicate<Instant>>builder()
			.put("5 minutes", parsed -> isWithinRange(Instant.now().plus(5, MINUTES), parsed))
			.put("90 seconds", parsed -> isWithinRange(Instant.now().plus(90, SECONDS), parsed))
			.put("999 hours", parsed -> isWithinRange(Instant.now().plus(999, HOURS), parsed))
			.put("10 days", parsed -> isWithinRange(Instant.now().plus(10, DAYS), parsed))
			.put("6pm", parsed -> isWithinRange(Instant.now()
				.atZone(ZoneId.systemDefault())
				.withHour(18)
				.withMinute(0)
				.withSecond(0)
				.withNano(0)
				.toInstant(), parsed))
			.put("tomorrow 9am", parsed -> isWithinRange(Instant.now()
				.atZone(ZoneId.systemDefault())
				.plus(1, DAYS)
				.withHour(9)
				.withMinute(0)
				.withSecond(0)
				.withNano(0)
				.toInstant(), parsed))
			.put("6:30pm", parsed -> isWithinRange(Instant.now()
				.atZone(ZoneId.systemDefault())
				.withHour(18)
				.withMinute(30)
				.withSecond(0)
				.withNano(0)
				.toInstant(), parsed))
			.put("tomorrow at 4 in the afternoon", parsed -> isWithinRange(Instant.now()
				.atZone(ZoneId.systemDefault())
				.plus(1, DAYS)
				.withHour(16)
				.withMinute(0)
				.withSecond(0)
				.withNano(0)
				.toInstant(), parsed))
			.build()
			.forEach((str, predicate) -> assertTrue(
				predicate.test(parser.parse(str)),
				format("%s was not within expected range", str)));
	}

	private static boolean isWithinRange(final Instant expected,
										 final Instant parsed) {
		/*
		 * I thought 2 seconds was an insane allowance.
		 * I was so clueless about just how slow the JVM is to warm up.
		 */
		return isWithinRange(expected, parsed, Duration.ofSeconds(2));
	}

	private static boolean isWithinRange(final Instant expected,
										 final Instant parsed,
										 final Duration range) {
		if (!(parsed.isBefore(expected.plus(range.toNanos() / 2, NANOS))
			&& parsed.isAfter(expected.minus(range.toNanos() / 2, NANOS)))) {
			System.err.println(format("Parsed: %s\nExpected: %s", parsed.toString(), expected.toString()));

			return false;
		}

		return true;
	}
}
