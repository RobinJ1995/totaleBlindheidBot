package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;

import java.util.Arrays;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;

import static java.util.stream.Collectors.joining;

public class WingmanHandler extends RollcallHandler {
	public WingmanHandler(final ResponseSender sender, final String ...users) {
		super(sender, users);
	}

	@Override
	String[] quotes() {
		return new String[] {
			"Be my wingman!",
			"Be my wingman yo!",
			"Let's score some!",
			"I'm a single pringle and ready to mingle!"
		};
	}

	@Override
	public String help() {
		return "Looking for a wingman?";
	}
}
