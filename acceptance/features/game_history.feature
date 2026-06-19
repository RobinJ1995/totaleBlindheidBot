Feature: CS2 game history
  The bot records each finished CS2 match (map, mode, final score, co-players) and exposes it
  via /game_history. A match ends on a score reset / map / mode change, or after the game has
  been idle. When a chat has Steam updates enabled, each finished match is also announced.

  Scenario: an idle game is recorded and announced, then shown in history
    Given a chat with id 2101
    And a user with id 5910 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000910"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000910"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000910" playing CS2 with score "16-14" on map "Inferno"
    Then chat 2101 receives a Steam message containing "is playing Counter-Strike"
    When Steam reports user "76561198000000910" stopped playing
    Then chat 2101 eventually receives a new Steam message containing "finished a game"
    And chat 2101 eventually receives a new Steam message containing "Inferno"
    When the user sends "/game_history"
    Then the bot reply contains "🏆"
    And the bot reply contains "Inferno"
    And the bot reply contains "16-14"

  Scenario: a loss is recorded on a score reset and marked with a skull
    Given a chat with id 2103
    And a user with id 5912 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000912"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000912"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000912" playing CS2 with score "14-16" on map "Mirage"
    And a moment passes
    And Steam reports user "76561198000000912" playing CS2 with score "1-0" on map "Mirage"
    Then chat 2103 eventually receives a new Steam message containing "finished a game"
    When the user sends "/game_history"
    Then the bot reply contains "☠️"
    And the bot reply contains "14-16"

  Scenario: a tie is marked with a handshake
    Given a chat with id 2104
    And a user with id 5913 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000913"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000913"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000913" playing CS2 with score "15-15" on map "Nuke"
    And a moment passes
    And Steam reports user "76561198000000913" playing CS2 with score "1-0" on map "Nuke"
    Then chat 2104 eventually receives a new Steam message containing "finished a game"
    When the user sends "/game_history"
    Then the bot reply contains "🤝"
    And the bot reply contains "15-15"

  Scenario: a relaunch mid-match stays a single match
    Given a chat with id 2105
    And a user with id 5914 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000914"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000914"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000914" playing CS2 with score "10-5" on map "Inferno"
    And Steam reports user "76561198000000914" stopped playing
    And a moment passes
    And Steam reports user "76561198000000914" playing CS2 with score "12-5" on map "Inferno"
    And a moment passes
    And Steam reports user "76561198000000914" playing CS2 with score "1-0" on map "Inferno"
    Then chat 2105 eventually receives a new Steam message containing "finished a game"
    When the user sends "/game_history"
    Then the bot reply contains "12-5"

  Scenario: a chat with Steam updates off records history but is not announced
    Given a chat with id 2102
    And a user with id 5920 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000920"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000920"
    When the user sends "/steam_updates off"
    Then the bot replies "Steam updates for this chat have been turned off."
    When Steam mappings are refreshed
    And Steam reports user "76561198000000920" playing CS2 with score "16-14" on map "Inferno"
    Then no Steam message is posted to chat 2102
    When Steam reports user "76561198000000920" playing CS2 with score "1-0" on map "Inferno"
    Then no Steam message is posted to chat 2102
    When the user sends "/game_history"
    Then the bot reply contains "16-14"

  Scenario: co-players in the same match are recorded
    Given a chat with id 2106
    When user 5930 sends "/steam_user_id 76561198000000930"
    Then the bot reply contains "76561198000000930"
    When user 5931 sends "/steam_user_id 76561198000000931"
    Then the bot reply contains "76561198000000931"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000930" playing CS2 with score "5-3" on map "Inferno"
    And Steam reports user "76561198000000931" playing CS2 with score "5-3" on map "Inferno"
    And Steam reports user "76561198000000930" playing CS2 with score "6-3" on map "Inferno"
    And Steam reports user "76561198000000931" stopped playing
    And Steam reports user "76561198000000930" stopped playing
    Then chat 2106 eventually receives a new Steam message containing "finished a game"
    When user 5930 sends "/game_history"
    Then the bot reply contains "with"

  Scenario: a user with no history is told so
    Given a chat with id 2107
    And a user with id 5940 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000940"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000940"
    When the user sends "/game_history"
    Then the bot replies "No game history yet."
