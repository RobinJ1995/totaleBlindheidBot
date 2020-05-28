package be.robinj.telegram.bot.totaleblindheid;

import be.robinj.telegram.bot.totaleblindheid.handler.command.CommandHandler;
import com.google.common.collect.ImmutableMap;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.vertx.core.Handler;
import io.vertx.core.logging.Logger;
import io.vertx.core.logging.LoggerFactory;
import io.vertx.ext.web.RoutingContext;

import java.util.Map;
import java.util.Optional;

import static java.util.Collections.emptyMap;

public class MessageRouter implements Handler<RoutingContext> {
	private final static Logger LOG = LoggerFactory.getLogger(MessageRouter.class);

	private Map<String, CommandHandler> handlers = emptyMap();

	@Override
	public void handle(final RoutingContext context) {
		final Request request = context.getBodyAsJson().mapTo(Request.class);

		this.process(request);

		context.response()
			.setStatusCode(HttpResponseStatus.OK.code())
			.end();
	}

	private void process(final Request request) {
		final String msg = request.getMessage().getText();
		if (new StringProcessor(msg).isEmpty()) {
			LOG.info("Message is empty.");
			return;
		} else if (!msg.startsWith("/")) {
			LOG.info("Message is not a command.");
			return;
		}

		final String command = msg.substring(1)
			.split("(\\s|@)+")[0]
			.toLowerCase();

		LOG.info("Command received: " + command);

		Optional.ofNullable(this.handlers.get(command))
			.ifPresentOrElse(
				handler -> handler.handle(request),
				() -> LOG.info(String.format("No handler for command %s.", command)));
	}

	public void registerHandler(final String command, final CommandHandler handler) {
		this.handlers = ImmutableMap.<String, CommandHandler>builder()
			.putAll(this.handlers)
			.put(command.toLowerCase(), handler)
			.build();
	}

	public Map<String, CommandHandler> getHandlers() {
		return this.handlers;
	}
}
