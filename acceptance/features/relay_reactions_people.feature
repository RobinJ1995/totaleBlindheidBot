Feature: mirroring reactions per person
  A reaction from a message's sender is not mirrored, and a person's linked Telegram and Discord
  accounts count as one: placing the same reaction on two copies shows it once on each.

  Background:
    Given a chat with id 8801
    And a user with id 8811 and first name "Rhea"
    And the user is an admin of the chat
    And a Discord server "8801" named "People One" with channel "88011" named "general" and member "rhea_dc" named "Rhea" with id "880100000000000001"
    And a Discord server "8802" named "People Two" with channel "88021" named "cs" and member "dup_dc" named "Dup" with id "880200000000000001"
    And Discord channel "88011" is linked to the chat
    And Discord channel "88021" is linked to the chat

  Scenario: the sender reacting to their own Telegram message is not mirrored
    When the user sends "my clip"
    Then Discord channel "88011" receives "my clip" from "Rhea"
    When user 8811 reacts to that message with "🔥"
    Then Discord channel "88011" sees no reaction changes from the bot
    And Discord channel "88021" sees no reaction changes from the bot

  Scenario: the sender reacting to a copy of their own Discord message is not mirrored
    When Discord user "bob" named "Bob" with id "880100000000000002" says "rush B" in channel "88021"
    Then the bot replies "bob: rush B"
    When Discord user "bob" with id "880100000000000002" reacts with "👍" to "rush B" in channel "88011"
    Then the bot does not react on Telegram
    And Discord channel "88021" sees no reaction changes from the bot

  Scenario: the sender reacting from their linked account on the other platform is not mirrored
    When the user sends "/link_user rhea rhea_dc"
    Then the bot replies "Linked Rhea to Discord user rhea_dc."
    When the user sends "first pick"
    Then Discord channel "88011" receives "first pick" from "Rhea"
    When Discord user "rhea_dc" with id "880100000000000001" reacts with "🔥" to "first pick" in channel "88011"
    Then the bot does not react on Telegram
    And Discord channel "88021" sees no reaction changes from the bot

  Scenario: a person's reaction on two platforms is shown once on each copy
    When user 8812 sends "/hi"
    Then the bot reply starts with "Hello to you too"
    When the user sends "/link_user user8812 dup_dc"
    Then the bot replies "Linked User8812 to Discord user dup_dc."
    When the user sends "aim duel"
    Then Discord channel "88011" receives "aim duel" from "Rhea"
    When user 8812 reacts to that message with "🔥"
    Then Discord channel "88011" sees the bot react with "🔥" to "aim duel"
    And Discord channel "88021" sees the bot react with "🔥" to "aim duel"
    When Discord user "dup_dc" with id "880200000000000001" reacts with "🔥" to "aim duel" in channel "88011"
    Then Discord channel "88011" sees the bot take back its "🔥" reaction to "aim duel"
    And Discord channel "88021" sees no reaction changes from the bot
    And the bot does not react on Telegram
    When user 8812 takes back their reaction to that message
    Then the bot reacts to that message with "🔥"
    And Discord channel "88021" sees no reaction changes from the bot

  Scenario: the same reaction from two different people is shown by both
    When the user sends "eco win"
    Then Discord channel "88011" receives "eco win" from "Rhea"
    When user 8813 reacts to that message with "🔥"
    Then Discord channel "88021" sees the bot react with "🔥" to "eco win"
    When Discord user "carol" with id "880100000000000003" reacts with "🔥" to "eco win" in channel "88011"
    Then the bot reacts to that message with "🔥"
    And Discord channel "88011" sees no reaction changes from the bot
