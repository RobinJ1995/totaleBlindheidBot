package be.robinj.telegram.bot.totaleblindheid.handler.command;

import be.robinj.telegram.bot.totaleblindheid.Request;
import be.robinj.telegram.bot.totaleblindheid.ResponseSender;

import java.util.Arrays;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;

import static java.util.stream.Collectors.joining;

public class DiscordHandler implements CommandHandler {
	private final ResponseSender sender;
	private final String discordInviteLink;

	public DiscordHandler(final ResponseSender sender, final String discordInviteLink) {
		this.sender = sender;
		this.discordInviteLink = discordInviteLink;
	}

	@Override
	public void handle(final Request request) {
		sender.send(request.getMessage().getChat().getId(), this.process());
	}

	private String process() {
		if (this.discordInviteLink == null) {
			return "Sorry, I don't have a Discord invite link for you right now :-(";
		}

		return this.discordInviteLink;
	}

	@Override
	public String help() {
		return "Discord invite link";
	}
}
