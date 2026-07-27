Feature: deleting match records
  The admin (STEAM_ADMIN_TELEGRAM_USER_ID, 9999 in this suite) can remove a mis-recorded
  match from a player's game history via /delete_match_record and an inline picker.
  Everyone else is refused.

  Scenario: the admin deletes a mis-recorded match record
    Given a chat with id 2301
    And a user with id 6101 and first name "Tester"
    When the user sends "/steam_user_id 76561198000001101"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000001101"
    When Steam mappings are refreshed
    And Steam reports user "76561198000001101" playing CS2 as "Alpha" with score "13-7" on map "Vertigo"
    And Steam reports user "76561198000001101" stopped playing
    Then chat 2301 eventually receives a new Steam message containing "won a game"
    When user 9999 sends "/delete_match_record Alpha"
    Then the bot reply contains "Select the match record to delete"
    When user 9999 named "Admin" taps the button containing "13-7"
    Then the Steam message in chat 2301 is edited to contain "Deleted match record"
    When the user sends "/game_history"
    Then the bot replies "No game history yet."

  Scenario: a non-admin cannot delete match records
    Given a chat with id 2302
    And a user with id 6102 and first name "Tester"
    When the user sends "/delete_match_record"
    Then the bot reply contains "Only the admin can delete match records"

  Scenario: a non-admin tapping the picker is refused
    Given a chat with id 2303
    And a user with id 6103 and first name "Tester"
    When the user sends "/steam_user_id 76561198000001103"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000001103"
    When Steam mappings are refreshed
    And Steam reports user "76561198000001103" playing CS2 as "Bravo" with score "13-7" on map "Nuke"
    And Steam reports user "76561198000001103" stopped playing
    Then chat 2303 eventually receives a new Steam message containing "won a game"
    When user 9999 sends "/delete_match_record Bravo"
    Then the bot reply contains "Select the match record to delete"
    When user 6103 named "Tester" taps the button containing "13-7"
    Then the tap is answered with "Only the admin can delete match records."
    When the user sends "/game_history"
    Then the bot reply contains "13-7"
