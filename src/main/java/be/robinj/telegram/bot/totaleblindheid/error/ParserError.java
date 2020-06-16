package be.robinj.telegram.bot.totaleblindheid.error;

public class ParserError extends IllegalArgumentException {
	public ParserError(final String message) {
		super(message);
	}

	public ParserError(final Exception ex) {
		super(ex);
	}
}
