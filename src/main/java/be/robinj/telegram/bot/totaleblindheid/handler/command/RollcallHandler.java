package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;

import java.util.Arrays;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;

import static java.util.stream.Collectors.joining;

public abstract class RollcallHandler extends CommandHandler {
	private final String[] users;

	protected RollcallHandler(final ResponseSender sender, final String ...users) {
		super(sender);
		this.users = users;
	}

	abstract String[] quotes();

	protected String randomQuote() {
		final String[] quotes = this.quotes();

		return quotes[new Random().nextInt(quotes.length)];
	}

	public String getMessage() {
		final String usernames = Arrays.stream(this.users)
			.map(user -> "@" + user)
			.sorted((a, b) -> ThreadLocalRandom.current().nextInt(-1, 2))
			.collect(joining(" "));

		return String.format("%s\n%s", this.randomQuote(), usernames);
	}

	@Override
	protected String process(final Request request) {
		return this.getMessage();
	}
}
