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
    Then chat 2101 eventually receives a new Steam message containing "won a game"
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
    Then chat 2103 eventually receives a new Steam message containing "lost a game"
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
    Then chat 2104 eventually receives a new Steam message containing "tied a game"
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
    Then chat 2105 eventually receives a new Steam message containing "won a game"
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
    Then chat 2106 eventually receives a new Steam message containing "won a game"
    When user 5930 sends "/game_history"
    Then the bot reply contains "with"

  Scenario: a user with no history is told so
    Given a chat with id 2107
    And a user with id 5940 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000940"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000940"
    When the user sends "/game_history"
    Then the bot replies "No game history yet."

  Scenario: two linked Steam accounts are tracked as independent matches
    # A match belongs to one Steam account and can't continue on another, so one account
    # stopping finalises its own match even while the other account is still in a game.
    Given a chat with id 2108
    And a user with id 5950 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000950,76561198000000951"
    Then the bot reply contains "76561198000000950"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000950" playing CS2 with score "16-14" on map "Inferno"
    And Steam reports user "76561198000000951" playing CS2 with score "5-3" on map "Mirage"
    And Steam reports user "76561198000000950" stopped playing
    Then chat 2108 eventually receives a new Steam message containing "won a game"
    When Steam reports user "76561198000000951" stopped playing
    And 8 seconds pass
    When the user sends "/game_history"
    Then the bot reply contains "16-14"
    And the bot reply contains "5-3"

  Scenario: a changing rich-presence summary does not split a match
    Given a chat with id 2109
    And a user with id 5960 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000960"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000960"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000960" playing CS2 summarised as "Competitive Inferno 5-3" with score "5-3" on map "Inferno"
    And a moment passes
    And Steam reports user "76561198000000960" playing CS2 summarised as "Competitive Inferno 8-3" with score "8-3" on map "Inferno"
    And a moment passes
    Then chat 2109 has not received a Steam message containing "won a game"
    When Steam reports user "76561198000000960" playing CS2 summarised as "Competitive Inferno 1-0" with score "1-0" on map "Inferno"
    Then chat 2109 eventually receives a new Steam message containing "won a game"
    When the user sends "/game_history"
    Then the bot reply contains "8-3"

  Scenario: players finishing the same match at different times share one announcement
    # Each player's Steam presence (and finalisation) arrives separately, so the first to finish
    # posts the message and the next edits it to add their name — one message per match, not one
    # per player.
    Given a chat with id 2110
    When user 5970 sends "/steam_user_id 76561198000000970"
    Then the bot reply contains "76561198000000970"
    When user 5971 sends "/steam_user_id 76561198000000971"
    Then the bot reply contains "76561198000000971"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000970" playing CS2 as "Alpha" with score "13-7" on map "Vertigo"
    And Steam reports user "76561198000000970" stopped playing
    And Steam reports user "76561198000000971" playing CS2 as "Bravo" with score "13-7" on map "Vertigo"
    And Steam reports user "76561198000000971" stopped playing
    Then chat 2110 eventually receives a new Steam message containing "won a game"
    # The second finaliser edits the first's message to add their name (order is irrelevant), so a
    # single announcement ends up naming both — proving one message per match, not one per player.
    And the Steam message in chat 2110 is edited to contain "Alpha"
    And the Steam message in chat 2110 is edited to contain "Bravo"

  Scenario: the same player's repeated match gets its own announcement
    # Two distinct matches that happen to share map, mode, result and score must not be merged into
    # one message just because they look alike — each real match is announced separately.
    Given a chat with id 2111
    And a user with id 5980 and first name "Tester"
    When the user sends "/steam_user_id 76561198000000980"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000000980"
    When Steam mappings are refreshed
    And Steam reports user "76561198000000980" playing CS2 with score "13-7" on map "Vertigo"
    And Steam reports user "76561198000000980" stopped playing
    And 8 seconds pass
    Then chat 2111 eventually receives a new Steam message containing "won a game"
    When Steam reports user "76561198000000980" playing CS2 with score "13-7" on map "Vertigo"
    And Steam reports user "76561198000000980" stopped playing
    And 8 seconds pass
    Then chat 2111 has received 2 Steam messages containing "won a game"
