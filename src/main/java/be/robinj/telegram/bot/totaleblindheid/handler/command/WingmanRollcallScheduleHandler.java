package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.ResponseSender;
import be.robinj.telegram.bot.totaleblindheid.schedule.RollcallSchedule;

public class WingmanRollcallScheduleHandler extends ScheduleRollcallHandler {
	public WingmanRollcallScheduleHandler(final ResponseSender sender,
										  final RollcallSchedule schedule) {
		super(sender, schedule);
	}

	@Override
	public String help() {
		return "Schedule a rollcall for CS:GO wingman";
	}
}
