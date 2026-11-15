Feature: chat leaderboard
  /leaderboard ranks the chat's players by competitive win rate. Only players with at least five
  competitive games make the board. An optional filter narrows it to a map, a mode, or the past
  week or month.

  Background:
    Given every scenario records these shared matches
      | player | name  | mode        | map     | score | days_ago |
      | 6401   | Alice | Competitive | Nuke    | 13-7  | 0        |
      | 6401   | Alice | Competitive | Nuke    | 13-9  | 1        |
      | 6401   | Alice | Premier     | Inferno | 13-5  | 2        |
      | 6401   | Alice | Premier     | Inferno | 13-11 | 20       |
      | 6401   | Alice | Competitive | Ancient | 7-13  | 20       |
      | 6402   | Bob   | Competitive | Nuke    | 13-7  | 0        |
      | 6402   | Bob   | Competitive | Nuke    | 13-4  | 1        |
      | 6402   | Bob   | Competitive | Nuke    | 3-13  | 2        |
      | 6402   | Bob   | Competitive | Inferno | 4-13  | 3        |
      | 6402   | Bob   | Competitive | Inferno | 13-13 | 20       |
      | 6402   | Bob   | Wingman     | Nuke    | 9-0   | 0        |
      | 6403   | Carl  | Competitive | Nuke    | 13-0  | 0        |
      | 6403   | Carl  | Competitive | Nuke    | 13-0  | 0        |
      | 6403   | Carl  | Competitive | Nuke    | 13-0  | 0        |
      | 6403   | Carl  | Competitive | Nuke    | 13-0  | 0        |

  Scenario: players are ranked by competitive win rate, leaving out those with too few games
    Given a chat with id 2401
    And the chat has recorded the shared matches
    When user 6401 sends "/leaderboard"
    Then the bot replies
      """
      🏆 Leaderboard
      1. Alice: ████████░░ 80% (5 games)
      2. Bob: ████░░░░░░ 40% (5 games)
      """

  Scenario: nobody makes a filtered board with fewer than five games each
    Given a chat with id 2402
    And the chat has recorded the shared matches
    When user 6401 sends "/leaderboard nuke week"
    Then the bot replies "Nobody has played 5 competitive games on Nuke in the past week yet."

  Scenario: the board can be narrowed to the past month
    Given a chat with id 2403
    And the chat has recorded the shared matches
    And the chat has recorded these matches
      | player | name  | mode        | map     | score | days_ago |
      | 6403   | Carl  | Competitive | Nuke    | 0-13  | 40       |
    When user 6401 sends "/leaderboard month"
    Then the bot replies
      """
      🏆 Leaderboard (past month)
      1. Alice: ████████░░ 80% (5 games)
      2. Bob: ████░░░░░░ 40% (5 games)
      """

  Scenario: older games count without a filter, equal rates ranked by name
    Given a chat with id 2404
    And the chat has recorded the shared matches
    And the chat has recorded these matches
      | player | name  | mode        | map     | score | days_ago |
      | 6403   | Carl  | Competitive | Nuke    | 0-13  | 40       |
    When user 6401 sends "/leaderboard"
    Then the bot replies
      """
      🏆 Leaderboard
      1. Alice: ████████░░ 80% (5 games)
      2. Carl: ████████░░ 80% (5 games)
      3. Bob: ████░░░░░░ 40% (5 games)
      """

  Scenario: the board can be narrowed to a mode
    Given a chat with id 2405
    And the chat has recorded the shared matches
    When user 6401 sends "/leaderboard premier"
    Then the bot replies "Nobody has played 5 competitive games in Premier yet."

  Scenario: /leaderboard works on Discord with a filter
    Given a chat with id 2406
    And the chat has recorded the shared matches
    And a Discord server "2406" named "Board" with channel "24061" named "general"
    And Discord channel "24061" is linked to the chat
    When Discord user "kit_cs" named "Kit" with id "240600000000000001" runs "/leaderboard" in channel "24061"
    Then Discord channel "24061" receives a bot message starting with "**🏆 Leaderboard**"
    And Discord channel "24061" receives a bot message containing "1. Alice: ████████░░ 80% (5 games)"
    When Discord user "kit_cs" named "Kit" with id "240600000000000001" runs "/leaderboard" with filter "inferno" in channel "24061"
    Then Discord channel "24061" receives a bot message
      """
      Nobody has played 5 competitive games on Inferno yet.
      """
