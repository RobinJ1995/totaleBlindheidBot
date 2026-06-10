Feature: Steam game-presence updates
  When a tracked user starts playing CS2 the bot posts to their chats and edits
  the message when the session ends. Chats that opted out receive nothing.

  Scenario: posting a game update and closing the session
    Given a chat with id 2001
    And a user with id 5901 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000010"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000010"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000010" playing CS2 on map "Inferno"
    Then chat 2001 receives a Steam message containing "is playing Counter-Strike"
    When Steam reports user "76561198000000010" stopped playing
    Then the Steam message in chat 2001 is edited to contain "🔴"

  Scenario: a chat that disabled updates receives nothing
    Given a chat with id 2002
    And a user with id 5902 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000020"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000020"
    When the user sends "/steam_updates off"
    Then the bot replies "Steam updates for this chat have been turned off."
    When Steam mappings are refreshed
    And Steam reports user "76561198000000020" playing CS2
    Then no Steam message is posted to chat 2002
