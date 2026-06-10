Feature: github_notify command
  Chats opt in or out of GitHub commit notifications.

  Scenario: missing argument prompts for on or off
    Given a chat with id 1950
    And a user with id 5950 and first name "Tester"
    When the user sends "/github_notify"
    Then the bot reply contains "to enable or disable GitHub notifications for this chat"

  Scenario: enabling notifications
    Given a chat with id 1951
    And a user with id 5951 and first name "Tester"
    When the user sends "/github_notify on"
    Then the bot replies "GitHub notifications for this chat have been turned on."

  Scenario: disabling notifications
    Given a chat with id 1952
    And a user with id 5952 and first name "Tester"
    When the user sends "/github_notify off"
    Then the bot replies "GitHub notifications for this chat have been turned off."
