Feature: CS2 competitive stats
  /stats aggregates a player's recorded competitive matches for the chat (games, win rate, streaks,
  favourite/best/worst map). By default it reports the sender's own stats; given a player name or
  mention it reports that player's stats instead.

  Scenario: a player's own competitive stats are aggregated
    Given a chat with id 2201
    And a user with id 6110 and first name "Tester"
    When the user sends "/steam_user_id 76561198000001110"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000001110"
    When Steam mappings are refreshed
    And Steam reports user "76561198000001110" playing CS2 with score "13-7" on map "Inferno"
    And Steam reports user "76561198000001110" stopped playing
    And 8 seconds pass
    Then chat 2201 eventually receives a new Steam message containing "won a game"
    When the user sends "/stats"
    Then the bot reply contains "Competitive games"
    And the bot reply contains "Win rate"

  Scenario: stats can be requested for another named player
    Given a chat with id 2202
    When user 6120 sends "/steam_user_id 76561198000001120"
    Then the bot reply contains "76561198000001120"
    When user 6121 sends "/steam_user_id 76561198000001121"
    Then the bot reply contains "76561198000001121"
    When Steam mappings are refreshed
    And Steam reports user "76561198000001120" playing CS2 as "Charlie" with score "13-7" on map "Nuke"
    And Steam reports user "76561198000001120" stopped playing
    And 8 seconds pass
    Then chat 2202 eventually receives a new Steam message containing "won a game"
    When user 6121 sends "/stats Charlie"
    Then the bot reply contains "Competitive stats for"
    And the bot reply contains "Charlie"
    And the bot reply contains "Competitive games"

  Scenario: stats can be requested by @username
    # The username is captured from the sender's messages, so a player who only went through the
    # Steam flow can still be looked up by @username.
    Given a chat with id 2204
    When user 6140 sends "/steam_user_id 76561198000001140"
    Then the bot reply contains "76561198000001140"
    When user 6141 sends "/steam_user_id 76561198000001141"
    Then the bot reply contains "76561198000001141"
    When Steam mappings are refreshed
    And Steam reports user "76561198000001140" playing CS2 as "Delta" with score "13-7" on map "Ancient"
    And Steam reports user "76561198000001140" stopped playing
    And 8 seconds pass
    Then chat 2204 eventually receives a new Steam message containing "won a game"
    When user 6141 sends "/stats @user6140"
    Then the bot reply contains "Competitive stats for"
    And the bot reply contains "Delta"
    And the bot reply contains "Competitive games"

  Scenario: stats for an unknown player is reported as such
    Given a chat with id 2203
    And a user with id 6130 and first name "Tester"
    When the user sends "/steam_user_id 76561198000001130"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000001130"
    When the user sends "/stats Nobody"
    Then the bot reply contains "I don't have any recorded games for"
