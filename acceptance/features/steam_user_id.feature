Feature: steam_user_id command
  Users register the SteamID64(s) the bot should track.

  Scenario: an invalid Steam ID is rejected
    Given a chat with id 1700
    And a user with id 5801 and first name "Tester"
    When the user sends "/steam_user_id 123"
    Then the bot reply contains "Please specify your Steam user ID(s) as SteamID64"

  Scenario: a valid SteamID64 is stored
    Given a chat with id 1700
    And a user with id 5802 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000000"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000000"

  Scenario: an admin sets a Steam ID on behalf of another user
    Given a chat with id 1700
    When user 9999 sends "/steam_user_id 12345 76561198000000001"
    Then the bot replies "Steam user ID(s) for user 12345 has been set to 76561198000000001"
