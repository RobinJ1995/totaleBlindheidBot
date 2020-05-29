package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;

import java.util.Arrays;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;

import static java.util.stream.Collectors.joining;

public class WingmanHandler implements CommandHandler {
	private static final String[] QUOTES = new String[] {
		"Be my wingman!",
		"Be my wingman yo!",
		"Let's score some!",
		"I'm a single pringle and ready to mingle!"
	};

	private final ResponseSender sender;
	private final String[] users;

	public WingmanHandler(final ResponseSender sender, final String ...users) {
		this.sender = sender;
		this.users = users;
	}

	@Override
	public void handle(final Request request) {
		final String usernames = Arrays.stream(users)
			.map(user -> "@" + user)
			.sorted((a, b) -> ThreadLocalRandom.current().nextInt(-1, 2))
			.collect(joining(" "));
		final String message = String.format("%s\n%s", randomQuote(), usernames);

		sender.send(request.getMessage().getChat().getId(), message);
	}

	private static String randomQuote() {
		final var random = new Random();

		return QUOTES[random.nextInt(QUOTES.length)];
	}

	@Override
	public String help() {
		return "Looking for wingman?";
	}
}
