Feature: schedule command
  The bot schedules rollcalls and validates the requested time.

  Scenario: scheduling without a time prompts for one
    Given a chat with id 4001
    And a user with id 5401 and first name "Tester"
    When the user sends "/schedule"
    Then the bot replies "Please specify a time to schedule the rollcall."

  Scenario: an unparseable time is rejected
    Given a chat with id 4002
    And a user with id 5402 and first name "Tester"
    When the user sends "/schedule blarg"
    Then the bot replies "Invalid time format."

  Scenario: scheduling less than two minutes ahead is rejected
    Given a chat with id 4003
    And a user with id 5403 and first name "Tester"
    When the user sends "/schedule 1 minute"
    Then the bot replies "Rollcall must be scheduled at least 2 minutes in advance."

  Scenario: scheduling more than twelve hours ahead is rejected
    Given a chat with id 4004
    And a user with id 5404 and first name "Tester"
    When the user sends "/schedule 13 hours"
    Then the bot replies "Rollcall cannot be scheduled more than 12 hours in advance."

  Scenario: a valid time is accepted
    Given a chat with id 4005
    And a user with id 5405 and first name "Tester"
    When the user sends "/schedule 3 hours"
    Then the bot reply starts with "Rollcall scheduled for"

  Scenario Outline: the scheduled time is rendered in the user's timezone
    Given a chat with id <chat_id>
    And a user with id <user_id> and first name "Tester"
    When the user sends "/timezone <tz_input>"
    Then the bot replies "Your timezone has been set to <stored>"
    When the user sends "/schedule 3 hours"
    Then the bot reply contains "Rollcall scheduled for"
    And the bot reply contains "<zone_label>"

    Examples:
      | chat_id | user_id | tz_input | stored | zone_label |
      | 4010    | 5410    | UTC+2    | +02:00 | GMT+2      |
      | 4011    | 5411    | UTC-5    | -05:00 | GMT-5      |
      | 4012    | 5412    | UTC      | UTC    | UTC        |
