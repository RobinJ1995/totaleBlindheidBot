package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;
import io.vertx.core.Handler;
import io.vertx.core.logging.Logger;
import io.vertx.core.logging.LoggerFactory;

public abstract class CommandHandler implements Handler<Request> {
	private final static Logger LOG = LoggerFactory.getLogger(CommandHandler.class);

	private final ResponseSender sender;

	protected CommandHandler(final ResponseSender sender) {
		this.sender = sender;
	}

	private String getMessage(final Request request) {
		try {
			return this.process(request);
		} catch (final Exception ex) {
			LOG.error(ex);
			return ex.toString();
		}
	}

	@Override
	public void handle(final Request request) {
		sender.send(request.getMessage().getChat().getId(), this.getMessage(request));
	}

	protected abstract String process(final Request request);

	public abstract String help();
}
