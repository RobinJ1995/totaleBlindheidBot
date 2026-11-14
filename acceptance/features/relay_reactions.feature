Feature: mirroring reactions
  Every copy of a relayed message shows the reactions on the others. On Discord the bot adds each
  emoji as its own reaction; on Telegram a bot can only react once, so it shows the most used one.

  Background:
    Given a chat with id 8701
    And a user with id 8711 and first name "Tester"
    And a Discord server "8701" named "React One" with channel "87011" named "general"
    And a Discord server "8702" named "React Two" with channel "87021" named "cs"
    And a Discord server "8703" named "React Plain" with channel "87031" named "general" where the bot lacks "Manage Webhooks"
    And Discord channel "87011" is linked to the chat
    And Discord channel "87021" is linked to the chat
    And Discord channel "87031" is linked to the chat

  Scenario: a Telegram reaction shows on every Discord copy
    When the user sends "ace!"
    Then Discord channel "87011" receives "ace!" from "Tester"
    When user 8712 reacts to that message with "👍"
    Then Discord channel "87011" sees the bot react with "👍" to "ace!"
    And Discord channel "87021" sees the bot react with "👍" to "ace!"
    And Discord channel "87031" sees the bot react with "👍" to "ace!"
    And the bot does not react on Telegram

  Scenario: the bot keeps a reaction until the last Telegram user takes theirs back
    When the user sends "clutch"
    Then Discord channel "87011" receives "clutch" from "Tester"
    When user 8712 reacts to that message with "🔥"
    Then Discord channel "87011" sees the bot react with "🔥" to "clutch"
    When user 8713 reacts to that message with "🔥"
    Then Discord channel "87011" sees no reaction changes from the bot
    When user 8712 takes back their reaction to that message
    Then Discord channel "87011" sees no reaction changes from the bot
    When user 8713 takes back their reaction to that message
    Then Discord channel "87011" sees the bot take back its "🔥" reaction to "clutch"
    And Discord channel "87021" sees the bot take back its "🔥" reaction to "clutch"

  Scenario: changing a Telegram reaction swaps it on Discord
    When the user sends "eco round"
    Then Discord channel "87011" receives "eco round" from "Tester"
    When user 8712 reacts to that message with "👍"
    Then Discord channel "87011" sees the bot react with "👍" to "eco round"
    When user 8712 reacts to that message with "👎"
    Then Discord channel "87011" sees the bot react with "👎" to "eco round"
    And Discord channel "87011" sees the bot take back its "👍" reaction to "eco round"

  Scenario: Telegram hearts arrive as Discord hearts
    When the user sends "love this map"
    Then Discord channel "87011" receives "love this map" from "Tester"
    When user 8712 reacts to that message with "❤"
    Then Discord channel "87011" sees the bot react with "❤️" to "love this map"

  Scenario: custom emoji reactions on Telegram are not mirrored
    When the user sends "nice"
    Then Discord channel "87011" receives "nice" from "Tester"
    When user 8712 reacts to that message with a custom emoji
    Then Discord channel "87011" sees no reaction changes from the bot

  Scenario: a Discord reaction shows on the Telegram original and the other Discord copies
    When the user sends "gg wp"
    Then Discord channel "87011" receives "gg wp" from "Tester"
    When Discord user "alice" with id "870100000000000001" reacts with "🎉" to "gg wp" in channel "87011"
    Then the bot reacts to that message with "🎉"
    And Discord channel "87021" sees the bot react with "🎉" to "gg wp"
    And Discord channel "87011" sees no reaction changes from the bot
    When Discord user "alice" with id "870100000000000001" removes their "🎉" reaction to "gg wp" in channel "87011"
    Then the bot takes back its reaction to that message
    And Discord channel "87021" sees the bot take back its "🎉" reaction to "gg wp"

  Scenario: the most used Discord reaction is the one shown on Telegram
    When Discord user "bob" named "Bob" with id "870100000000000002" says "rush B" in channel "87021"
    Then the bot replies "bob: rush B"
    When the latest bot message is remembered
    And Discord user "alice" with id "870100000000000001" reacts with "👍" to "rush B" in channel "87011"
    Then the bot reacts to the remembered message with "👍"
    And Discord channel "87021" sees the bot react with "👍" to "rush B"
    When Discord user "carol" with id "870100000000000003" reacts with "🔥" to "rush B" in channel "87011"
    Then Discord channel "87021" sees the bot react with "🔥" to "rush B"
    When Discord user "dave" with id "870100000000000004" reacts with "🔥" to "rush B" in channel "87031"
    Then the bot reacts to the remembered message with "🔥"

  Scenario: a Discord reaction Telegram doesn't offer still shows on Discord
    When the user sends "pistol round"
    Then Discord channel "87011" receives "pistol round" from "Tester"
    When Discord user "alice" with id "870100000000000001" reacts with "🦀" to "pistol round" in channel "87011"
    Then Discord channel "87021" sees the bot react with "🦀" to "pistol round"
    And the bot does not react on Telegram

  Scenario: Discord custom emoji reactions are not mirrored
    When the user sends "boom"
    Then Discord channel "87011" receives "boom" from "Tester"
    When Discord user "alice" with id "870100000000000001" reacts with the custom emoji "pog" to "boom" in channel "87011"
    Then the bot does not react on Telegram
    And Discord channel "87021" sees no reaction changes from the bot

  Scenario: a Telegram reaction on a Discord message shows on its original
    When Discord user "bob" named "Bob" with id "870100000000000002" says "wp all" in channel "87021"
    Then the bot replies "bob: wp all"
    When the latest bot message is remembered
    And user 8712 reacts to the remembered message with "🏆"
    Then Discord channel "87021" sees the bot react with "🏆" to "wp all"
    And Discord channel "87011" sees the bot react with "🏆" to "wp all"
