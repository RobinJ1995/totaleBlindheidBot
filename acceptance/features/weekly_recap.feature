Feature: Weekly recap
  On Sunday from 20:00 (RECAP_TIMEZONE, Amsterdam by default) every chat that played competitive
  or premier games in the past week gets a recap. The acceptance bot's clock stands still at
  Sunday 1 March 2020, 20:30 in Amsterdam.

  Scenario: a chat that played this week gets a recap once
    Given chat 2601 recorded these matches
      | player | name  | mode        | map    | score | message | with | ended_at            |
      | 6601   | Alpha | Competitive | Mirage | 13-5  | 1       | 6602 | 2020-02-28 20:00:00 |
      | 6602   | Bravo | Competitive | Mirage | 13-5  | 1       | 6601 | 2020-02-28 20:00:00 |
      | 6601   | Alpha | Premier     | Nuke   | 13-11 | 2       | 6602 | 2020-02-29 20:00:00 |
      | 6601   | Alpha | Competitive | Nuke   | 4-13  | 3       |      | 2020-02-29 21:00:00 |
      | 6603   | Cleo  | Casual      | Nuke   | 8-0   | 4       |      | 2020-02-29 21:00:00 |
      | 6603   | Cleo  | Competitive | Nuke   | 13-0  | 5       |      | 2020-02-20 21:00:00 |
    Then chat 2601 receives this weekly recap
      """
      📅 Weekly recap: 3 games, 2W 1L
      Best map: Mirage (1/1 won)
      Most active: Alpha (3 games)
      Best duo: Alpha & Bravo (2/2 won)
      """
    And chat 2601 receives no other weekly recap

  Scenario: a chat with Steam updates off gets no recap
    Given a chat with id 2602
    And a user with id 6604 and first name "Kit"
    When the user sends "/steam_updates off"
    Then the bot replies "Steam updates for this chat have been turned off."
    Given chat 2602 recorded these matches
      | player | name | mode        | map    | score | ended_at            |
      | 6604   | Kit  | Competitive | Mirage | 13-5  | 2020-02-28 20:00:00 |
    Then chat 2602 receives no weekly recap

  Scenario: a chat that only played other modes gets no recap
    Given chat 2603 recorded these matches
      | player | name | mode    | map    | score | ended_at            |
      | 6605   | Kit  | Casual  | Mirage | 8-3   | 2020-02-28 20:00:00 |
      | 6605   | Kit  | Wingman | Nuke   | 9-3   | 2020-02-29 20:00:00 |
    Then chat 2603 receives no weekly recap

  Scenario: a chat that last played before this week gets no recap
    Given chat 2604 recorded these matches
      | player | name | mode        | map    | score | ended_at            |
      | 6606   | Kit  | Competitive | Mirage | 13-5  | 2020-02-23 19:00:00 |
    Then chat 2604 receives no weekly recap

  Scenario: games after the recap's moment are left for next week
    Given chat 2605 recorded these matches
      | player | name | mode        | map    | score | ended_at            |
      | 6607   | Kit  | Competitive | Mirage | 13-5  | 2020-03-01 20:00:00 |
    Then chat 2605 receives no weekly recap
