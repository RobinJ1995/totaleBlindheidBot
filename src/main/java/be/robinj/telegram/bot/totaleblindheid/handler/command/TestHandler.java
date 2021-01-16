package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;

public class TestHandler extends CommandHandler {
	public TestHandler(final ResponseSender sender) {
		super(sender);
	}

	@Override
	public String process(final Request request) {
		return "Works! Send /help to see what I can do.";
	}

	@Override
	public String help() {
		return "I wonder...";
	}
}
