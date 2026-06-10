Feature: cancel command
  The bot cancels a scheduled rollcall for the chat.

  Scenario: cancelling when nothing is scheduled
    Given a chat with id 4101
    And a user with id 5411 and first name "Tester"
    When the user sends "/cancel"
    Then the bot replies "No rollcall scheduled for this group."

  Scenario: cancelling an existing schedule
    Given a chat with id 4102
    And a user with id 5412 and first name "Tester"
    When the user sends "/schedule 3 hours"
    Then the bot reply starts with "Rollcall scheduled for"
    When the user sends "/cancel"
    Then the bot replies "Scheduled rollcall cancelled."
