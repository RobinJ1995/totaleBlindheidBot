package be.robinj.telegram.bot.totaleblindheid.schedule;

import be.robinj.telegram.bot.totaleblindheid.ResponseSender;
import io.vertx.core.Handler;

import java.time.Instant;

public abstract class MessageSchedule implements Handler<Long> {
	private Instant triggerTime = null;
	private Long chatId = null;

	private final ResponseSender sender;

	protected MessageSchedule(final ResponseSender sender) {
		this.sender = sender;
	}

	public synchronized void schedule(final Instant when, final Long chatId) {
		this.triggerTime = when;
		this.chatId = chatId;
	}

	public synchronized void cancel() {
		this.triggerTime = null;
		this.chatId = null;
	}

	public boolean shouldTrigger() {
		if (this.triggerTime == null) {
			return false;
		}

		return triggerTime.isBefore(Instant.now());
	}

	public abstract void fire();

	@Override
	public synchronized void handle(final Long event) {
		if (this.shouldTrigger()) {
			this.fire();
			this.cancel();
		}
	}

	protected void sendMessage(final String message) {
		this.sender.send(this.chatId, message);
	}
}
