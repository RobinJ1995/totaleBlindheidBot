package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;

import java.util.Arrays;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;

import static java.util.stream.Collectors.joining;

public class RollcallHandler implements CommandHandler {
	private static final String[] QUOTES = new String[] {
		"Are we rushin' in, or are we going' sneaky-beaky like?",
		"Bingo, bango, bongo, bish, bash, bosh!",
		"Easy peasy, lemon squeezy!",
		"Grab your gear and let's go!",
		"RUSH B DON'T STOP"
	};

	private final ResponseSender sender;
	private final String[] users;

	public RollcallHandler(final ResponseSender sender, final String ...users) {
		this.sender = sender;
		this.users = users;
	}

	@Override
	public void handle(final Request request) {
		final String usernames = Arrays.stream(this.users)
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
		return "Call all players!";
	}
}
