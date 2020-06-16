package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.MessageRouter;
import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;

import static java.util.stream.Collectors.joining;

public class HelpHandler extends CommandHandler {
	private final MessageRouter router;

	public HelpHandler(final ResponseSender sender, final MessageRouter router) {
		super(sender);
		this.router = router;
	}

	@Override
	protected String process(final Request request) {
		return this.router.getHandlers()
			.entrySet()
			.stream()
			.map(command -> "/" + command.getKey() + ": " + command.getValue().help())
			.collect(joining("\n"));
	}

	@Override
	public String help() {
		return "List commands";
	}
}
