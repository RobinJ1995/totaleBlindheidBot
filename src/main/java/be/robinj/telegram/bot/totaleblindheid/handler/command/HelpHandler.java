package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.MessageRouter;
import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;

import static java.util.stream.Collectors.joining;

public class HelpHandler implements CommandHandler {
	private final ResponseSender sender;
	private final MessageRouter router;

	public HelpHandler(final ResponseSender sender, final MessageRouter router) {
		this.sender = sender;
		this.router = router;
	}

	@Override
	public void handle(final Request request) {
		final String message = this.router.getHandlers()
			.entrySet()
			.stream()
			.map(command -> "/" + command.getKey() + ": " + command.getValue().help())
			.collect(joining("\n"));

		this.sender.send(request.getMessage().getChat().getId(), message);
	}

	@Override
	public String help() {
		return "List commands";
	}
}
