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

  Scenario: a Discord message reaches Telegram and the other channels
    When Discord user "alice" named "Alice" with id "801001" says "count me in" in channel "80011"
    Then the bot replies "Alice: count me in"
    And the bot reply has "Alice:" in bold
    And Discord channel "80021" receives "count me in" from "Alice"
    And Discord channel "80011" receives nothing

  Scenario: Discord mentions are relayed as names
    When Discord user "alice" named "Alice" with id "801001" says "<@801002000000000002> you coming?" in channel "80011" mentioning user "801002000000000002" named "Bob"
    Then the bot replies "Alice: @Bob you coming?"

  Scenario: the bot does not relay its own Discord messages
    When the bot itself says "Linked!" in Discord channel "80011"
    Then the bot sends no reply
    And Discord channel "80021" receives nothing

  Scenario: the bot does not relay what its own webhooks posted
    When the relay webhook of channel "80011" posts "hello from Telegram"
    Then the bot sends no reply
    And Discord channel "80021" receives nothing

  Scenario: a message in an unlinked channel goes nowhere
    Given a Discord server "8003" named "Elsewhere" with channel "80031" named "random"
    When Discord user "carol" named "Carol" with id "801003" says "hi?" in channel "80031"
    Then the bot sends no reply
    And Discord channel "80011" receives nothing

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
    When Discord user "dave" named "Dave" with id "801004" says "fine by me" in channel "80011"
    Then Discord channel "80041" receives "fine by me" posted by the bot as "Dave"
