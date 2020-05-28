package be.robinj.telegram.bot.totaleblindheid;

public class StringProcessor {
	private final String string;

	public StringProcessor(final String string) {
		this.string = string;
	}

	public boolean isEmpty() {
		return this.string == null || "".equals(this.string.strip());
	}

	public String emptyToNull() {
		if (this.isEmpty()) {
			return null;
		}

		return string;
	}

	public String or(final String fallback) {
		if (this.emptyToNull() == null) {
			return fallback;
		}

		return this.string;
	}

	@Override
	public String toString() {
		return this.string;
	}
}
