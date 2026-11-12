Feature: duo stats
  /stats <player> <player> compares how the first player does in competitive games together with
  the second against how they do overall. Names may contain spaces, so the whole argument is tried
  as one player first, then every split between words.

  Background:
    Given every scenario records these shared matches
      | player | name  | map     | score | with |
      | 6501   | Alice | Nuke    | 13-7  | 6502 |
      | 6501   | Alice | Nuke    | 13-9  | 6502 |
      | 6501   | Alice | Inferno | 13-5  | 6502 |
      | 6501   | Alice | Inferno | 5-13  | 6502 |
      | 6501   | Alice | Ancient | 7-13  | 6502 |
      | 6501   | Alice | Ancient | 7-13  |      |
      | 6501   | Alice | Ancient | 2-13  |      |
      | 6502   | Bob   | Nuke    | 13-7  | 6501 |
      | 6502   | Bob   | Nuke    | 13-9  | 6501 |
      | 6502   | Bob   | Inferno | 13-5  | 6501 |
      | 6502   | Bob   | Inferno | 5-13  | 6501 |
      | 6502   | Bob   | Ancient | 7-13  | 6501 |
      | 6503   | Carl  | Nuke    | 13-0  |      |

  Scenario: a player's games with another are compared to their overall record
    Given a chat with id 2501
    And the chat has recorded the shared matches
    When user 6503 sends "/stats Alice Bob"
    Then the bot replies
      """
      🤝 Alice with Bob
      Together: ██████░░░░ 60% (5 games)
      Overall: ████░░░░░░ 43% (7 games)
      """

  Scenario: player names may contain spaces
    Given a chat with id 2502
    And the chat has recorded these matches
      | player | name      | map  | score | with |
      | 6511   | Bob Smith | Nuke | 13-7  | 6512 |
      | 6511   | Bob Smith | Nuke | 7-13  |      |
      | 6512   | Ann       | Nuke | 13-7  | 6511 |
    When user 6512 sends "/stats Bob Smith Ann"
    Then the bot replies
      """
      🤝 Bob Smith with Ann
      Together: ██████████ 100% (1 game)
      Overall: █████░░░░░ 50% (2 games)
      """

  Scenario: a name with a space is one player before it is two
    Given a chat with id 2505
    And the chat has recorded these matches
      | player | name      | map  | score | with |
      | 6521   | Bob Smith | Nuke | 13-7  |      |
      | 6522   | Bob       | Nuke | 13-7  | 6523 |
      | 6523   | Smith     | Nuke | 13-7  | 6522 |
    When user 6521 sends "/stats Bob Smith"
    Then the bot reply starts with "Competitive stats for Bob Smith"

  Scenario: an argument that splits into two pairs of players asks to be more specific
    Given a chat with id 2507
    And the chat has recorded these matches
      | player | name  | map  | score |
      | 6531   | Al    | Nuke | 13-7  |
      | 6532   | Al Bo | Nuke | 13-7  |
      | 6533   | Bo Cy | Nuke | 13-7  |
      | 6534   | Cy    | Nuke | 13-7  |
    When user 6531 sends "/stats Al Bo Cy"
    Then the bot replies
      """
      "Al Bo Cy" matches multiple players: Al and Bo Cy, Al Bo and Cy. Please be more specific.
      """

  Scenario: players who never played together are told so
    Given a chat with id 2503
    And the chat has recorded the shared matches
    When user 6501 sends "/stats Bob Carl"
    Then the bot replies "Bob hasn't played a competitive game with Carl yet."

  Scenario: an argument that is neither a player nor a pair is reported as such
    Given a chat with id 2504
    And the chat has recorded the shared matches
    When user 6501 sends "/stats Alice Nobody"
    Then the bot replies
      """
      I don't have any recorded games for "Alice Nobody" in this chat.
      """

  Scenario: duo stats on Discord
    Given a chat with id 2506
    And the chat has recorded the shared matches
    And a Discord server "2506" named "Duos" with channel "25061" named "general"
    And Discord channel "25061" is linked to the chat
    When Discord user "kit_cs" named "Kit" with id "250600000000000001" runs "/stats" with player "Alice Bob" in channel "25061"
    Then Discord channel "25061" receives a bot message
      """
      **🤝 Alice with Bob**
      Together: ██████░░░░ 60% (5 games)
      Overall: ████░░░░░░ 43% (7 games)
      """
