package be.robinj.telegram.bot.totaleblindheid;

import be.robinj.telegram.bot.totaleblindheid.handler.FailureHandler;
import be.robinj.telegram.bot.totaleblindheid.handler.LoggingHandler;
import be.robinj.telegram.bot.totaleblindheid.handler.command.CompetitiveRollcallScheduleHandler;
import be.robinj.telegram.bot.totaleblindheid.handler.command.DiscordHandler;
import be.robinj.telegram.bot.totaleblindheid.handler.command.HelpHandler;
import be.robinj.telegram.bot.totaleblindheid.handler.command.CompetitiveRollcallHandler;
import be.robinj.telegram.bot.totaleblindheid.handler.command.TestHandler;
import be.robinj.telegram.bot.totaleblindheid.handler.command.WingmanHandler;
import be.robinj.telegram.bot.totaleblindheid.handler.command.WingmanRollcallScheduleHandler;
import be.robinj.telegram.bot.totaleblindheid.schedule.RollcallSchedule;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jdk8.Jdk8Module;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fasterxml.jackson.module.mrbean.MrBeanModule;
import io.vertx.core.AbstractVerticle;
import io.vertx.core.Promise;
import io.vertx.core.json.jackson.DatabindCodec;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.client.WebClient;
import io.vertx.ext.web.client.WebClientOptions;
import io.vertx.ext.web.handler.BodyHandler;

import java.time.Duration;

public class MainVerticle extends AbstractVerticle {

	@Override
	public void start(Promise<Void> startPromise) throws Exception {
		final int port = new EnvVar("HTTP_PORT").or(8000);
		final boolean httpLog = new EnvVar("HTTP_LOG").or(false);
		final String botToken = new EnvVar("BOT_TOKEN").orThrow();
		final String[] rollcallUsers = new EnvVar("ROLLCALL_USERS").orThrow()
			.split("\\s+");
		final String discordInviteLink = new EnvVar("DISCORD_INVITE_LINK").orNull();
		final boolean debug = new EnvVar("DEBUG").or(false);

		configureObjectMapper();

		final var webClient = WebClient.create(this.vertx,
			new WebClientOptions()
			.setConnectTimeout(ResponseSender.TIMEOUT_MS)
			.setLogActivity(httpLog));
		final var responseSender = new ResponseSender(webClient, botToken, debug);

		final var competitiveRollcall = new CompetitiveRollcallHandler(
			responseSender, rollcallUsers);
		final var wingmanRollcall = new WingmanHandler(responseSender, rollcallUsers);

		final var competitiveRollcallSchedule = new RollcallSchedule(
			responseSender, competitiveRollcall);
		final var wingmanRollcallSchedule = new RollcallSchedule(
			responseSender, wingmanRollcall);

		final var router = new MessageRouter();
		router.registerHandler("test", new TestHandler(responseSender));
		router.registerHandler("help", new HelpHandler(responseSender, router));
		router.registerHandler("rollcall", competitiveRollcall);
		router.registerHandler("wingman", wingmanRollcall);
		router.registerHandler("schedule", new CompetitiveRollcallScheduleHandler(
			responseSender, competitiveRollcallSchedule));
		router.registerHandler("schedule_wingman", new WingmanRollcallScheduleHandler(
			responseSender, wingmanRollcallSchedule));
		router.registerHandler("discord", new DiscordHandler(responseSender, discordInviteLink));

		final var vertxRouter = Router.router(this.vertx);
		vertxRouter.route().handler(BodyHandler.create());
		vertxRouter.route().handler(new LoggingHandler());
		vertxRouter.route().failureHandler(new FailureHandler());
		vertxRouter.route().handler(router);

		vertx.setPeriodic(Duration.ofSeconds(15L).toMillis(), competitiveRollcallSchedule);
		vertx.setPeriodic(Duration.ofSeconds(15L).toMillis(), wingmanRollcallSchedule);

		this.vertx.createHttpServer()
			.requestHandler(vertxRouter)
			.listen(port, http -> {
				if (http.succeeded()) {
					startPromise.complete();
					System.out.println(String.format("HTTP server started on port %s", port));
				} else {
					startPromise.fail(http.cause());
				}
			});
	}

	private static void configureObjectMapper() {
		configureObjectMapper(DatabindCodec.mapper());
		configureObjectMapper(DatabindCodec.prettyMapper());
	}

	private static void configureObjectMapper(final ObjectMapper objectMapper) {
		objectMapper.registerModule(new Jdk8Module())
			.registerModule(new JavaTimeModule())
			.registerModule(new MrBeanModule());
		objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
	}
}
