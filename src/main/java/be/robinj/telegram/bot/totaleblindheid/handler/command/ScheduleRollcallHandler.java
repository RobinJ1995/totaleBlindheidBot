package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;
import be.robinj.telegram.bot.totaleblindheid.parser.TimeParser;
import be.robinj.telegram.bot.totaleblindheid.schedule.RollcallSchedule;
import com.google.common.base.Preconditions;

import java.time.Instant;
import java.util.Arrays;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;

import static com.google.common.base.Preconditions.checkArgument;
import static java.time.temporal.ChronoUnit.DAYS;
import static java.util.stream.Collectors.joining;

public abstract class ScheduleRollcallHandler extends CommandHandler {
	private RollcallSchedule schedule;

	protected ScheduleRollcallHandler(final ResponseSender sender,
									  final RollcallSchedule schedule) {
		super(sender);
		this.schedule = schedule;
	}

	@Override
	protected String process(final Request request) {
		final String[] params = request.getMessage().getParameters();
		if (params.length == 0) {
			return "Please supply a time. Accepted formats: 5 minutes, 1 hour, or an ISO-8601 timestamp.";
		} else if (params.length > 2) {
			return "Wrong number of parameters.";
		}

		final Instant time = new TimeParser().parse(String.join(" ", params));
		checkArgument(time.isBefore(Instant.now().plus(2, DAYS)),
			"You cannot schedule a rollcall more than 2 days in advance.");
		this.schedule.schedule(time, request.getMessage().getChat().getId());

		return "Rollcall scheduled for " + time.toString();
	}
}
