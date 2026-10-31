Feature: scheduling rollcalls across Telegram and Discord
  A schedule made on either platform is confirmed in the Telegram group and every linked channel,
  with the RSVP buttons on every copy. Cancelling retires every copy, and when the time comes the
  rollcall takes over from the confirmations everywhere.

  Background:
    Given a chat with id 10101
    And a user with id 11101 and first name "Captain"
    And a Discord server "10101" named "Server One" with channel "101011" named "general"
    And a Discord server "10102" named "Server Two" with channel "101021" named "cs"
    And Discord channel "101011" is linked to the chat
    And Discord channel "101021" is linked to the chat

  Scenario: a Telegram schedule is confirmed in every linked channel
    When the user sends "/schedule 3 hours"
    Then the bot reply starts with "Rollcall scheduled for"
    And the bot reply offers a "I'm in" button
    And Discord channel "101011" receives a bot message containing "Rollcall scheduled for" with buttons "I'm in, Maybe, No"
    And Discord channel "101021" receives a bot message containing "Rollcall scheduled for" with buttons "I'm in, Maybe, No"
    When the user sends "/cancel"
    Then the bot replies "Scheduled rollcall cancelled."

  Scenario: a Discord schedule is confirmed on Telegram and the other channel
    When Discord user "alice" named "Alice" with id "101010000000000002" runs "/schedule" with time "3 hours" in channel "101011"
    Then the bot reply starts with "Rollcall scheduled for"
    And the bot reply contains "🙋‍♂️ Alice"
    And Discord channel "101011" receives a bot message containing "🙋‍♂️ Alice" with buttons "I'm in, Maybe, No"
    And Discord channel "101021" receives a bot message containing "🙋‍♂️ Alice" with buttons "I'm in, Maybe, No"
    When Discord user "alice" named "Alice" with id "101010000000000002" runs "/cancel" in channel "101021"
    Then the bot replies "Scheduled rollcall cancelled."
    And Discord channel "101021" receives a bot message starting with "Scheduled rollcall cancelled."
    And Discord channel "101011" receives a bot message starting with "Scheduled rollcall cancelled."

  Scenario: a Discord schedule without a time is answered only there
    When Discord user "alice" named "Alice" with id "101010000000000002" runs "/schedule" in channel "101011"
    Then Discord channel "101011" receives a bot message starting with "Please specify a time to schedule the rollcall."
    And the bot sends no reply
    And Discord channel "101021" receives nothing

  Scenario: cancelling from Discord retires every copy
    When the user sends "/schedule 3 hours"
    Then the bot reply starts with "Rollcall scheduled for"
    When the latest bot message is remembered
    And the latest bot message in Discord channel "101011" is remembered
    And Discord user "alice" named "Alice" with id "101010000000000002" runs "/cancel" in channel "101021"
    Then the bot replies "Scheduled rollcall cancelled."
    And the remembered Discord message is edited to contain "Rollcall scheduled for" without buttons
    When Discord user "bob" named "Bob" with id "101010000000000003" taps "rsvp:yes" on the remembered Discord message
    Then the Discord tap is answered with "This RSVP has expired."

  Scenario: cancelling with nothing scheduled is answered where asked
    When Discord user "alice" named "Alice" with id "101010000000000002" runs "/cancel" in channel "101011"
    Then Discord channel "101011" receives a bot message starting with "No rollcall scheduled for this group."
    And the bot sends no reply

  Scenario: when the time comes the rollcall takes over on every platform
    When the user sends "/schedule 3 hours"
    Then the bot reply starts with "Rollcall scheduled for"
    When the latest bot message in Discord channel "101011" is remembered
    And Discord user "bob" named "Bob" with id "101010000000000003" taps "rsvp:yes" on the remembered Discord message
    Then the remembered Discord message is edited to contain "🙋‍♂️ Captain Bob"
    When the scheduled rollcall's time has come
    Then the bot reply offers a "Joining" button
    And the bot reply contains "🙋‍♂️ Captain Bob"
    And Discord channel "101011" receives a bot message containing "🙋‍♂️ Captain Bob" with buttons "Joining, Maybe/Later, No"
    And Discord channel "101021" receives a bot message containing "🙋‍♂️ Captain Bob" with buttons "Joining, Maybe/Later, No"
    And the remembered Discord message is edited to contain "Rollcall scheduled for" without buttons
