package be.robinj.telegram.bot.totaleblindheid.schedule;

import be.robinj.telegram.bot.totaleblindheid.ResponseSender;
import be.robinj.telegram.bot.totaleblindheid.handler.command.RollcallHandler;

public class RollcallSchedule extends MessageSchedule {
	private final RollcallHandler handler;

	public RollcallSchedule(final ResponseSender sender, final RollcallHandler handler) {
		super(sender);
		this.handler = handler;
	}

	@Override
	public void fire() {
		this.sendMessage(this.handler.getMessage());
	}
}
