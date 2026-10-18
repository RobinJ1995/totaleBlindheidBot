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

  Scenario: an admin sets a Steam ID for another user by @username
    Given a chat with id 1701
    When user 5811 sends "/hi"
    Then the bot replies "Hello to you too, User5811!"
    When user 9999 sends "/steam_user_id @user5811 76561198000000011"
    Then the bot replies "Steam user ID(s) for @user5811 has been set to 76561198000000011"

  Scenario: an admin sets Steam IDs for another user by tapped mention
    Given a chat with id 1702
    And a user with id 9999 and first name "Admin"
    When the user sends "/steam_user_id Bob 76561198000000012, 76561198000000013" mentioning user 5812 as "Bob"
    Then the bot replies "Steam user ID(s) for Bob has been set to 76561198000000012, 76561198000000013"

  Scenario: an admin naming an unknown @username is told so
    Given a chat with id 1703
    When user 9999 sends "/steam_user_id @nobody_here 76561198000000014"
    Then the bot replies "I can't tell who @nobody_here is. They need to have sent a message where I can see it."

  Scenario: a non-admin cannot set Steam IDs for someone else
    Given a chat with id 1704
    When user 5814 sends "/steam_user_id @user5811 76561198000000015"
    Then the bot replies "Only the admin can set Steam IDs for other users."

  Scenario: an admin can no longer target a numeric Telegram user ID
    Given a chat with id 1705
    When user 9999 sends "/steam_user_id 12345 76561198000000001"
    Then the bot reply contains "Please specify your Steam user ID(s) as SteamID64"

  Scenario: an admin picks a user from the chat and replies with their Steam ID
    Given a chat with id 1706
    When user 5816 sends "/hi"
    Then the bot replies "Hello to you too, User5816!"
    Given a user with id 9999 and first name "Admin"
    When the user sends "/steam_user_id"
    Then the bot reply starts with "Whose Steam ID(s) do you want to set?"
    And the bot reply offers a "User5816 (@user5816)" button
    When user 5817 named "Sneaky" taps the button containing "User5816"
    Then the tap is answered with "Only the admin can set Steam IDs for other users."
    When user 9999 named "Admin" taps the button containing "User5816"
    And a moment passes
    Then the bot reply contains "Reply to this message with the Steam ID(s) for User5816"
    When the latest bot message is remembered
    And the user replies "not an id" to the remembered message
    Then the bot replies "Invalid Steam ID(s). Each must be a 17-digit number (SteamID64) starting with 7656."
    When the user replies "76561198000000016" to the remembered message
    Then the bot replies "Steam user ID(s) for User5816 has been set to 76561198000000016"
