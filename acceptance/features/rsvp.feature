Feature: RSVP buttons on schedules and rollcalls
  Schedule confirmations and rollcalls carry inline RSVP buttons. The whole rotation is
  tagged up front, players start uncategorised, and they move between the 🙋‍♂️/🤷‍♂️/🙅‍♂️
  lists as they tap. Each scenario uses a distinct chat so the per-chat state stays isolated.

  Scenario: a schedule tags the whole rotation but pre-categorises nobody
    Given a chat with id 6001
    And a user with id 6101 and first name "Captain"
    When the user sends "/rollcall_add_player Alice" mentioning user 777 as "Alice"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/schedule 3 hours"
    Then the bot reply starts with "Rollcall scheduled for"
    And the bot reply contains "tg://user?id=777"
    And the bot reply contains "🙋‍♂️ Captain"
    And the bot reply does not contain "🤷‍♂️"
    And the bot reply offers a "I'm in" button
    And the bot reply offers a "Maybe" button
    And the bot reply offers a "No" button

  Scenario: tapping moves a player between the RSVP lists
    Given a chat with id 6002
    And a user with id 6102 and first name "Captain"
    When the user sends "/rollcall_add_player Alice" mentioning user 777 as "Alice"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/schedule 3 hours"
    Then the bot reply starts with "Rollcall scheduled for"
    When the RSVP message is remembered
    When user 777 named "Alice" taps maybe
    Then the bot reply contains "🤷‍♂️ Alice"
    When user 777 named "Alice" taps no
    Then the bot reply contains "🙅‍♂️ Alice"
    And the bot reply does not contain "🤷‍♂️"

  Scenario: a rollcall offers the Joining / Maybe/Later / No buttons and seeds the initiator
    Given a chat with id 6003
    And a user with id 6103 and first name "Captain"
    When the user sends "/rollcall"
    Then the bot reply offers a "Joining" button
    And the bot reply offers a "Maybe/Later" button
    And the bot reply offers a "No" button
    And the bot reply contains "🙋‍♂️ Captain"

  Scenario: tapping a cancelled schedule's message reports an expired RSVP
    Given a chat with id 6004
    And a user with id 6104 and first name "Captain"
    When the user sends "/schedule 3 hours"
    Then the bot reply starts with "Rollcall scheduled for"
    When the RSVP message is remembered
    When the user sends "/cancel"
    Then the bot replies "Scheduled rollcall cancelled."
    When user 777 named "Alice" taps yes
    Then the tap is answered with "This RSVP has expired."

  Scenario: rescheduling retires the previous RSVP list
    Given a chat with id 6005
    And a user with id 6105 and first name "Captain"
    When the user sends "/schedule 3 hours"
    Then the bot reply starts with "Rollcall scheduled for"
    When the RSVP message is remembered
    When the user sends "/schedule 4 hours"
    Then the bot reply starts with "Rollcall scheduled for"
    When user 777 named "Alice" taps yes
    Then the tap is answered with "This RSVP has expired."
