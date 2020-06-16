package be.robinj.telegram.bot.totaleblindheid;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.Arrays;

public interface Request {
	@JsonProperty("update_id") Long getUpdateId();
	@JsonProperty("message") Message getMessage();

	interface User {
		@JsonProperty("id") Long getId();
		@JsonProperty("is_bot") Boolean getIsBot();
		@JsonProperty("first_name") String getFirstName();
		@JsonProperty("last_name") String getLastName();
		@JsonProperty("username") String getUsername();
		@JsonProperty("language_code") String getLanguageCode();
	}

	interface Chat {
		@JsonProperty("id") Long getId();
		@JsonProperty("first_name") String getFirstName();
		@JsonProperty("last_name") String getLastName();
		@JsonProperty("username") String getUsername();
		@JsonProperty("type") String getType();
	}

	interface Message {
		@JsonProperty("message_id") Long getMessageId();
		@JsonProperty("from") User getFrom();
		@JsonProperty("chat") Chat getChat();
		@JsonProperty("date") Instant getDate();
		@JsonProperty("text") String getText();

		default String[] getParameters() {
			final String[] split = this.getText().split("\\s+");

			return Arrays.copyOfRange(split, 1, split.length);
		}
	}
}
