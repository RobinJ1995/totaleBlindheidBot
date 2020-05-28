package be.robinj.telegram.bot.totaleblindheid.handler;

import io.netty.handler.codec.http.HttpResponseStatus;
import io.vertx.core.Handler;
import io.vertx.core.logging.Logger;
import io.vertx.core.logging.LoggerFactory;
import io.vertx.ext.web.RoutingContext;

public class LoggingHandler implements Handler<RoutingContext> {
	private final static Logger LOG = LoggerFactory.getLogger(LoggingHandler.class);

	@Override
	public void handle(final RoutingContext context) {
		context.addBodyEndHandler(x -> {
			final String requestBody = context.getBodyAsString();
			final int responseStatus = context.response().getStatusCode();

			LOG.info(String.format("Request handled with status code %s. Body: %s",
				responseStatus, requestBody));
		});
		context.next();
	}
}
