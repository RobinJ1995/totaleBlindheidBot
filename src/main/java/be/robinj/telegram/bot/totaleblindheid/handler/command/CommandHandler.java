package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import io.vertx.core.Handler;

public interface CommandHandler extends Handler<Request> {
	String help();
}
