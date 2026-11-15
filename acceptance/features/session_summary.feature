Feature: Session summary
  Once nobody in a chat is playing any more and every match has been recorded, the chat gets a
  summary of the matches played since the last session ended (at most 12 hours back). A session
  of fewer than two matches gets none.

  Scenario: the last player to stop gets a summary that includes their last match
    Given a chat with id 2601
    And a user with id 6601 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002601"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002601"
    Given chat 2601 already has these finished matches
      | player | name | mode        | map    | score | minutes_ago |
      | 6601   | Kit  | Competitive | Mirage | 13-5  | 90          |
      | 6601   | Kit  | Competitive | Mirage | 9-13  | 45          |
      | 6601   | Kit  | Competitive | Nuke   | 13-2  | 800         |
    When Steam mappings are refreshed
    And Steam reports user "76561198000002601" playing CS2 as "Kit" with score "13-7" on map "Inferno"
    And Steam reports user "76561198000002601" stopped playing
    Then chat 2601 eventually receives a new Steam message containing "Session summary: 3 games, 2W 1L"
    And chat 2601 has received 1 Steam messages containing "Maps: Mirage ×2, Inferno"

  Scenario: no summary while someone in the chat is still playing
    Given a chat with id 2602
    When user 6602 sends "/steam_user_id 76561198000002602"
    Then the bot reply contains "76561198000002602"
    When user 6603 sends "/steam_user_id 76561198000002603"
    Then the bot reply contains "76561198000002603"
    When Steam mappings are refreshed
    And Steam reports user "76561198000002602" playing CS2 as "Alpha" with score "13-7" on map "Vertigo"
    And Steam reports user "76561198000002602" playing CS2 as "Alpha" with score "1-0" on map "Anubis"
    And Steam reports user "76561198000002603" playing CS2 as "Bravo" with score "3-3" on map "Dust II"
    And Steam reports user "76561198000002602" stopped playing
    And the matches of Steam user "76561198000002602" have been recorded
    Then chat 2602 has not received a Steam message containing "Session summary"
    When Steam reports user "76561198000002603" stopped playing
    Then chat 2602 eventually receives a new Steam message containing "Session summary: 3 games"

  Scenario: a single match gets no summary
    Given a chat with id 2603
    And a user with id 6604 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002604"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002604"
    When Steam mappings are refreshed
    And Steam reports user "76561198000002604" playing CS2 as "Kit" with score "13-7" on map "Inferno"
    And Steam reports user "76561198000002604" stopped playing
    And the matches of Steam user "76561198000002604" have been recorded
    Then chat 2603 eventually receives a new Steam message containing "won a game"
    And chat 2603 has not received a Steam message containing "Session summary"

  Scenario: a session is summarised once
    Given a chat with id 2604
    And a user with id 6605 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002605"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002605"
    Given chat 2604 already has these finished matches
      | player | name | mode        | map    | score | minutes_ago |
      | 6605   | Kit  | Competitive | Mirage | 13-5  | 45          |
    When Steam mappings are refreshed
    And Steam reports user "76561198000002605" playing CS2 as "Kit" with score "13-7" on map "Inferno"
    And Steam reports user "76561198000002605" stopped playing
    Then chat 2604 eventually receives a new Steam message containing "Session summary: 2 games"
    When Steam reports user "76561198000002605" left CS2 but stayed online
    Then no Steam message is posted to chat 2604

  Scenario: a chat with Steam updates off gets no summary
    Given a chat with id 2605
    And a user with id 6606 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002606"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002606"
    When the user sends "/steam_updates off"
    Then the bot replies "Steam updates for this chat have been turned off."
    Given chat 2605 already has these finished matches
      | player | name | mode        | map    | score | minutes_ago |
      | 6606   | Kit  | Competitive | Mirage | 13-5  | 45          |
    When Steam mappings are refreshed
    And Steam reports user "76561198000002606" playing CS2 as "Kit" with score "13-7" on map "Inferno"
    And Steam reports user "76561198000002606" stopped playing
    And the matches of Steam user "76561198000002606" have been recorded
    Then chat 2605 has not received a Steam message containing "Session summary"
