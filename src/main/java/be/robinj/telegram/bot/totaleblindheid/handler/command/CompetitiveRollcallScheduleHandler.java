package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;
import be.robinj.telegram.bot.totaleblindheid.parser.TimeParser;
import be.robinj.telegram.bot.totaleblindheid.schedule.RollcallSchedule;

import java.time.Instant;

public class CompetitiveRollcallScheduleHandler extends ScheduleRollcallHandler {
	public CompetitiveRollcallScheduleHandler(final ResponseSender sender,
											  final RollcallSchedule schedule) {
		super(sender, schedule);
	}

	@Override
	public String help() {
		return "Schedule a rollcall for competitive CS:GO";
	}
}
