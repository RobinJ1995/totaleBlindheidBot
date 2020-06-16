package be.robinj.telegram.bot.totaleblindheid;

import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.logging.Logger;
import io.vertx.core.logging.LoggerFactory;
import io.vertx.ext.web.client.WebClient;
import io.vertx.ext.web.client.predicate.ResponsePredicate;

import static io.vertx.core.Future.succeededFuture;

public class ResponseSender {
	private final static Logger LOG = LoggerFactory.getLogger(ResponseSender.class);

	static final int TIMEOUT_MS = 10_000;

	private final WebClient webClient;
	private final String botToken;
	private final boolean debug;

	ResponseSender(final WebClient webClient, final String botToken, final boolean debug) {
		this.webClient = webClient;
		this.botToken = botToken;
		this.debug = debug;
	}

	public Future<Void> send(final Long chatId, final String message) {
		if (this.debug) {
			LOG.info(String.format("chat_id=%s message=\"%s\"", chatId, message));

			return succeededFuture();
		}

		final Promise<Void> promise = Promise.promise();

		this.webClient.getAbs(
			String.format("https://api.telegram.org/bot%s/sendmessage", this.botToken))
			.addQueryParam("chat_id", chatId.toString())
			.addQueryParam("text", message)
			.timeout(TIMEOUT_MS)
			.expect(ResponsePredicate.SC_SUCCESS)
			.send(handler -> {
				if (handler.failed()) {
					LOG.error("Failed to send message.", handler.cause());
					promise.fail(handler.cause());
					return;
				}

				LOG.info("Sent message: " + message);
				promise.complete();
			});

		return promise.future();
	}
}
