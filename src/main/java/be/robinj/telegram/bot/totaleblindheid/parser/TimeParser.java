package be.robinj.telegram.bot.totaleblindheid.parser;

import be.robinj.telegram.bot.totaleblindheid.error.ParserError;
import com.joestelmach.natty.Parser;

import java.time.Instant;

import static com.google.common.base.Preconditions.checkArgument;
import static java.lang.String.format;
import static org.apache.commons.lang.StringUtils.isNotEmpty;

public class TimeParser {
	private static final Parser PARSER = new Parser();

	public Instant parse(final String str) throws ParserError {
		try {
			checkArgument(isNotEmpty(str));

			return PARSER.parse(str).get(0).getDates().get(0).toInstant();
		} catch (final IndexOutOfBoundsException ex) {
			throw new ParserError(format("I don't know what time \"%s\" is supposed to be.", str));
		} catch (final Exception ex) {
			throw new ParserError(ex);
		}
	}
}
