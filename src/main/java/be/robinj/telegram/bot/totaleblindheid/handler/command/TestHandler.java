package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;

public class TestHandler implements CommandHandler {
	private final ResponseSender sender;

	public TestHandler(final ResponseSender sender) {
		this.sender = sender;
	}

	@Override
	public void handle(final Request request) {
		sender.send(request.getMessage().getChat().getId(), "Werkt!");
	}

	@Override
	public String help() {
		return "I wonder...";
	}
}
