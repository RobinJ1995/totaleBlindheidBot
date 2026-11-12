Feature: Session summary
  Once nobody in a chat is playing any more and every match has been recorded, the chat gets a
  summary of the matches played since the last session ended (at most 12 hours back). A session
  of fewer than two matches gets none.

  Scenario: the last player to stop gets a summary that includes their last match
    Given a chat with id 2501
    And a user with id 6501 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002501"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002501"
    Given chat 2501 already has these finished matches
      | player | name | mode        | map    | score | minutes_ago |
      | 6501   | Kit  | Competitive | Mirage | 13-5  | 90          |
      | 6501   | Kit  | Competitive | Mirage | 9-13  | 45          |
      | 6501   | Kit  | Competitive | Nuke   | 13-2  | 800         |
    When Steam mappings are refreshed
    And Steam reports user "76561198000002501" playing CS2 as "Kit" with score "13-7" on map "Inferno"
    And Steam reports user "76561198000002501" stopped playing
    Then chat 2501 eventually receives a new Steam message containing "Session summary: 3 games, 2W 1L"
    And chat 2501 has received 1 Steam messages containing "Maps: Mirage ×2, Inferno"

  Scenario: no summary while someone in the chat is still playing
    Given a chat with id 2502
    When user 6502 sends "/steam_user_id 76561198000002502"
    Then the bot reply contains "76561198000002502"
    When user 6503 sends "/steam_user_id 76561198000002503"
    Then the bot reply contains "76561198000002503"
    When Steam mappings are refreshed
    And Steam reports user "76561198000002502" playing CS2 as "Alpha" with score "13-7" on map "Vertigo"
    And Steam reports user "76561198000002502" playing CS2 as "Alpha" with score "1-0" on map "Anubis"
    And Steam reports user "76561198000002503" playing CS2 as "Bravo" with score "3-3" on map "Dust II"
    And Steam reports user "76561198000002502" stopped playing
    And the matches of Steam user "76561198000002502" have been recorded
    Then chat 2502 has not received a Steam message containing "Session summary"
    When Steam reports user "76561198000002503" stopped playing
    Then chat 2502 eventually receives a new Steam message containing "Session summary: 3 games"

  Scenario: a single match gets no summary
    Given a chat with id 2503
    And a user with id 6504 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002504"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002504"
    When Steam mappings are refreshed
    And Steam reports user "76561198000002504" playing CS2 as "Kit" with score "13-7" on map "Inferno"
    And Steam reports user "76561198000002504" stopped playing
    And the matches of Steam user "76561198000002504" have been recorded
    Then chat 2503 eventually receives a new Steam message containing "won a game"
    And chat 2503 has not received a Steam message containing "Session summary"

  Scenario: a session is summarised once
    Given a chat with id 2504
    And a user with id 6505 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002505"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002505"
    Given chat 2504 already has these finished matches
      | player | name | mode        | map    | score | minutes_ago |
      | 6505   | Kit  | Competitive | Mirage | 13-5  | 45          |
    When Steam mappings are refreshed
    And Steam reports user "76561198000002505" playing CS2 as "Kit" with score "13-7" on map "Inferno"
    And Steam reports user "76561198000002505" stopped playing
    Then chat 2504 eventually receives a new Steam message containing "Session summary: 2 games"
    When Steam reports user "76561198000002505" left CS2 but stayed online
    Then no Steam message is posted to chat 2504

  Scenario: a chat with Steam updates off gets no summary
    Given a chat with id 2505
    And a user with id 6506 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002506"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002506"
    When the user sends "/steam_updates off"
    Then the bot replies "Steam updates for this chat have been turned off."
    Given chat 2505 already has these finished matches
      | player | name | mode        | map    | score | minutes_ago |
      | 6506   | Kit  | Competitive | Mirage | 13-5  | 45          |
    When Steam mappings are refreshed
    And Steam reports user "76561198000002506" playing CS2 as "Kit" with score "13-7" on map "Inferno"
    And Steam reports user "76561198000002506" stopped playing
    And the matches of Steam user "76561198000002506" have been recorded
    Then chat 2505 has not received a Steam message containing "Session summary"
