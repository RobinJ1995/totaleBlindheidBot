package be.robinj.telegram.bot.totaleblindheid.handler;

import io.netty.handler.codec.http.HttpResponseStatus;
import io.vertx.core.Handler;
import io.vertx.core.logging.Logger;
import io.vertx.core.logging.LoggerFactory;
import io.vertx.ext.web.RoutingContext;

public class FailureHandler implements Handler<RoutingContext> {
	private final static Logger LOG = LoggerFactory.getLogger(FailureHandler.class);

	@Override
	public void handle(final RoutingContext event) {
		LOG.error(event.failure());

		event.response()
			.setStatusCode(HttpResponseStatus.INTERNAL_SERVER_ERROR.code())
			.end(event.failure().getMessage());
	}
}
