Feature: steam_updates command
  Chats opt in or out of Steam game-presence updates.

  Scenario: missing argument prompts for on or off
    Given a chat with id 1800
    And a user with id 5810 and first name "Tester"
    When the user sends "/steam_updates"
    Then the bot reply contains "to enable or disable Steam updates for this chat"

  Scenario: enabling updates
    Given a chat with id 1801
    And a user with id 5811 and first name "Tester"
    When the user sends "/steam_updates on"
    Then the bot replies "Steam updates for this chat have been turned on."

  Scenario: disabling updates
    Given a chat with id 1802
    And a user with id 5812 and first name "Tester"
    When the user sends "/steam_updates off"
    Then the bot replies "Steam updates for this chat have been turned off."
