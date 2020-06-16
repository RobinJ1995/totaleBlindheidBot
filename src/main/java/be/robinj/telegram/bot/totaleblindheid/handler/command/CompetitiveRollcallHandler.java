package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;

import java.util.Arrays;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;

import static java.util.stream.Collectors.joining;

public class CompetitiveRollcallHandler extends RollcallHandler {
	public CompetitiveRollcallHandler(final ResponseSender sender, final String ...users) {
		super(sender, users);
	}

	@Override
	protected String[] quotes() {
		return new String[] {
			"Are we rushin' in, or are we going' sneaky-beaky like?",
			"Bingo, bango, bongo, bish, bash, bosh!",
			"Easy peasy, lemon squeezy!",
			"Grab your gear and let's go!",
			"RUSH B DON'T STOP"
		};
	}

	@Override
	public String help() {
		return "Call all players!";
	}
}
