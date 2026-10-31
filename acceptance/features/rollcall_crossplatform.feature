Feature: rollcalls and wingman calls across Telegram and Discord
  A rollcall or wingman call made on either platform is posted in the Telegram group and in every
  linked Discord channel. Every copy of a rollcall carries the RSVP buttons, a tap anywhere updates
  every copy, and people are pinged where they can be reached and named elsewhere.

  Background:
    Given a chat with id 10001
    And a user with id 11001 and first name "Captain"
    And a Discord server "10001" named "Server One" with channel "100011" named "general" and member "erin_cs" named "Erin" with id "100010000000000001"
    And a Discord server "10002" named "Server Two" with channel "100021" named "cs"
    And Discord channel "100011" is linked to the chat
    And Discord channel "100021" is linked to the chat

  Scenario: a wingman call from Telegram reaches the channels
    When the user sends "/wingman"
    Then the bot reply first line is one of
      | quote                                     |
      | Be my wingman!                            |
      | Be my wingman yo!                         |
      | Let's score some!                         |
      | I'm a single pringle and ready to mingle! |
    And Discord channel "100011" receives a bot message whose first line is one of
      | quote                                     |
      | Be my wingman!                            |
      | Be my wingman yo!                         |
      | Let's score some!                         |
      | I'm a single pringle and ready to mingle! |
