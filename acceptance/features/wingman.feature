Feature: wingman command
  The bot calls for a wingman with a random quote.

  Scenario: wingman replies with one of the known quotes
    Given a chat with id 1300
    And a user with id 5300 and first name "Tester"
    When the user sends "/wingman"
    Then the bot reply first line is one of
      | quote                                  |
      | Be my wingman!                         |
      | Be my wingman yo!                      |
      | Let's score some!                      |
      | I'm a single pringle and ready to mingle! |
