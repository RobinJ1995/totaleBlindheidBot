package be.robinj.telegram.bot.totaleblindheid;

import java.util.Optional;

public class EnvVar {
	private String name;

	public EnvVar(final String name) {
		this.name = name;
	}

	public Optional<String> get() {
		return Optional.ofNullable(System.getenv(this.name))
			.map(StringProcessor::new)
			.map(StringProcessor::emptyToNull);
	}

	public String or(final String fallback) {
		return this.get()
			.orElse(fallback);
	}

	public String orNull() {
		return this.get()
			.orElse(null);
	}

	public Long or(final Long fallback) {
		return this.get()
			.map(Long::valueOf)
			.orElse(fallback);
	}

	public Integer or(final Integer fallback) {
		return this.get()
			.map(Integer::valueOf)
			.orElse(fallback);
	}

	public Boolean or(final Boolean fallback) {
		return this.get()
			.map(Boolean::valueOf)
			.orElse(fallback);
	}

	public String orThrow() {
		return this.get()
			.orElseThrow(() -> new IllegalArgumentException(
				"Missing environment variable: " + this.name));
	}
}
