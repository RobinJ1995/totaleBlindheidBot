Feature: timezone command
  Users can view and set their timezone, used for scheduling.

  Scenario: viewing the default timezone
    Given a chat with id 1500
    And a user with id 5500 and first name "Tester"
    When the user sends "/timezone"
    Then the bot replies "Your current timezone is UTC"

  Scenario: an unknown timezone is rejected
    Given a chat with id 1500
    And a user with id 5501 and first name "Tester"
    When the user sends "/timezone Xyzzy"
    Then the bot replies "Invalid timezone: Xyzzy"

  Scenario: setting and persisting a timezone
    Given a chat with id 1500
    And a user with id 5502 and first name "Tester"
    When the user sends "/timezone Dublin"
    Then the bot replies "Your timezone has been set to Europe/Dublin"
    When the user sends "/timezone"
    Then the bot replies "Your current timezone is Europe/Dublin"
