Feature: help command
  The bot lists the available commands.

  Scenario: default help lists slash-prefixed commands
    Given a chat with id 1600
    And a user with id 5600 and first name "Tester"
    When the user sends "/help"
    Then the bot reply contains "/hi: Craving that small talk, are you?"

  Scenario: botfather format drops the slash and uses a dash
    Given a chat with id 1600
    And a user with id 5601 and first name "Tester"
    When the user sends "/help botfather"
    Then the bot reply contains "hi - Craving that small talk, are you?"
