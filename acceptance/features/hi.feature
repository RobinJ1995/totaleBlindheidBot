Feature: hi command
  The bot greets the user back by name.

  Scenario: greeting the default user
    Given a chat with id 1100
    And a user with id 5100 and first name "Tester"
    When the user sends "/hi"
    Then the bot replies "Hello to you too, Tester!"

  Scenario: greeting uses the sender's first name
    Given a chat with id 1100
    And a user with id 5101 and first name "Robin"
    When the user sends "/hi"
    Then the bot replies "Hello to you too, Robin!"
