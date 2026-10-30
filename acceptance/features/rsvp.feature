Feature: RSVP buttons on schedules and rollcalls
  Schedule confirmations and rollcalls carry inline RSVP buttons. The whole rotation is
  tagged up front, players start uncategorised, and they move between the 🙋‍♂️/🤷‍♂️/🙅‍♂️
  lists as they tap. The buttons are coloured (green yes, blue maybe, red no) and count how
  many people picked each option. Each scenario uses a distinct chat so the per-chat state stays isolated.

  Scenario: a schedule tags the whole rotation but pre-categorises nobody
    Given a chat with id 6001
    And a user with id 6101 and first name "Captain"
    When the user sends "/rollcall_add_player Alice" mentioning user 777 as "Alice"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/schedule 3 hours"
    Then the bot reply starts with "Rollcall scheduled for"
    And the bot reply links "Alice" to "tg://user?id=777"
    And the bot reply contains "🙋‍♂️ Captain"
    And the bot reply does not contain "🤷‍♂️"
    And the bot reply offers a success "✅ I'm in · 1" button
    And the bot reply offers a primary "Maybe" button
    And the bot reply offers a danger "No" button

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
    And the bot reply offers a primary "Maybe · 1" button
    When user 777 named "Alice" taps no
    Then the bot reply contains "🙅‍♂️ Alice"
    And the bot reply does not contain "🤷‍♂️"
    And the bot reply offers a primary "Maybe" button
    And the bot reply offers a danger "No · 1" button

  Scenario: a rollcall offers the Joining / Maybe/Later / No buttons and seeds the initiator
    Given a chat with id 6003
    And a user with id 6103 and first name "Captain"
    When the user sends "/rollcall"
    Then the bot reply offers a success "✅ Joining · 1" button
    And the bot reply offers a primary "Maybe/Later" button
    And the bot reply offers a danger "No" button
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

  Scenario: the button counts include people outside the rotation
    Given a chat with id 6006
    And a user with id 6106 and first name "Captain"
    When the user sends "/rollcall"
    Then the bot reply offers a success "✅ Joining · 1" button
    When the RSVP message is remembered
    When user 888 named "Outsider" taps yes
    Then the bot reply contains "Outsider"
    And the bot reply offers a success "✅ Joining · 2" button
    When user 6106 named "Captain" taps maybe
    Then the bot reply offers a success "✅ Joining · 1" button
    And the bot reply offers a primary "Maybe/Later · 1" button
