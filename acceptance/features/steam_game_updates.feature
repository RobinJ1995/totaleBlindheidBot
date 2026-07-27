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

  Scenario: a less-detailed update does not overwrite a more-detailed one
    Given a chat with id 2003
    And a user with id 5903 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000030"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000030"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000030" playing CS2 with score "16-14" on map "Inferno"
    Then chat 2003 receives a Steam message containing "Score:"
    When a moment passes
    And Steam reports user "76561198000000030" playing CS2 with no details
    Then the latest Steam message in chat 2003 still contains "Score:"

  Scenario: a bare relaunch after a closed session goes back to green
    Given a chat with id 2004
    And a user with id 5904 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000040"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000040"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000040" playing CS2 with score "16-14" on map "Inferno"
    Then chat 2004 receives a Steam message containing "Score:"
    When Steam reports user "76561198000000040" stopped playing
    Then the Steam message in chat 2004 is edited to contain "🔴"
    When a moment passes
    And Steam reports user "76561198000000040" playing CS2 with no details
    Then the latest Steam message in chat 2004 still contains "🟢"

  Scenario: round outcomes are tracked in the live message
    Given a chat with id 2005
    And a user with id 5905 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000050"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000050"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000050" playing CS2 with score "1-0" on map "Inferno"
    Then chat 2005 receives a Steam message containing "Rounds: 🎖️"
    When a moment passes
    And Steam reports user "76561198000000050" playing CS2 with score "1-1" on map "Inferno"
    Then the Steam message in chat 2005 is edited to contain "Rounds: 🎖️☠️"

  Scenario: a finished match is listed above the live game state for the session
    Given a chat with id 2006
    And a user with id 5906 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000060"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000060"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000060" playing CS2 with score "13-8" on map "Vertigo"
    Then chat 2006 receives a Steam message containing "is playing Counter-Strike"
    When a moment passes
    And Steam reports user "76561198000000060" playing CS2 with score "1-0" on map "Vertigo"
    And a moment passes
    And Steam reports user "76561198000000060" playing CS2 with score "2-0" on map "Vertigo"
    Then the Steam message in chat 2006 is edited to contain "🏆 Competitive: Vertigo 1️⃣3️⃣:8️⃣"

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
