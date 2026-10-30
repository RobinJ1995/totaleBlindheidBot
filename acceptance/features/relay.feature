Feature: relaying messages between a Telegram group and its Discord channels
  A Telegram group and the Discord channels linked to it form one conversation: what someone says
  in any of them is repeated in all the others under their name, and the bot never echoes itself.

  Background:
    Given a chat with id 8001
    And a user with id 8101 and first name "Tester"
    And a Discord server "8001" named "Server One" with channel "80011" named "general"
    And a Discord server "8002" named "Server Two" with channel "80021" named "cs"
    And Discord channel "80011" is linked to the chat
    And Discord channel "80021" is linked to the chat

  Scenario: a Telegram message reaches every linked channel
    When the user sends "anyone up for a game?"
    Then Discord channel "80011" receives "anyone up for a game?" from "Tester"
    And Discord channel "80021" receives "anyone up for a game?" from "Tester"
    And the bot sends no reply

  Scenario: Telegram formatting becomes Discord markdown
    When the user sends "we play at nine" with "nine" in bold
    Then Discord channel "80011" receives "we play at **nine**" from "Tester"

  Scenario: a Telegram group without links sends nothing to Discord
    Given a chat with id 8009
    And a user with id 8109 and first name "Loner"
    When the user sends "hello?"
    Then Discord channel "80011" receives nothing

  Scenario: without a webhook the bot posts relays itself with the name in front
    Given a Discord server "8004" named "Plain Server" with channel "80041" named "general" where the bot lacks "Manage Webhooks"
    And Discord channel "80041" is linked to the chat
    When the user sends "no webhooks here"
    Then Discord channel "80041" receives "no webhooks here" posted by the bot as "Tester"
