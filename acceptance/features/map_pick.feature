Feature: map pick
  /map suggests a map for the people who said yes to the chat's latest rollcall, or the rotation
  when nobody did, from their combined competitive record. It names the map they win most (with at
  least three games) and the one they lose most.

  Background:
    Given every scenario records these shared matches
      | player | name  | map     | score |
      | 6601   | Alice | Nuke    | 13-7  |
      | 6601   | Alice | Nuke    | 13-9  |
      | 6601   | Alice | Inferno | 7-13  |
      | 6601   | Alice | Inferno | 5-13  |
      | 6601   | Alice | Ancient | 13-11 |
      | 6602   | Bob   | Nuke    | 13-4  |
      | 6602   | Bob   | Inferno | 13-10 |
      | 6602   | Bob   | Inferno | 8-13  |
      | 6602   | Bob   | Ancient | 13-2  |
      | 6603   | Carl  | Vertigo | 13-0  |
      | 6603   | Carl  | Vertigo | 13-0  |
      | 6603   | Carl  | Vertigo | 13-0  |
      | 6603   | Carl  | Vertigo | 13-0  |
      | 6603   | Carl  | Inferno | 13-0  |
      | 6603   | Carl  | Inferno | 13-0  |
      | 6603   | Carl  | Inferno | 13-0  |

  Scenario: the map is picked for the yes-voters of the latest rollcall
    Given a chat with id 2601
    And the chat has recorded the shared matches
    And a user with id 6601 and first name "Alice"
    When the user sends "/rollcall"
    Then the bot reply contains "🙋‍♂️ Alice"
    When the RSVP message is remembered
    And user 6602 named "Bob" taps yes
    Then the bot reply contains "Bob"
    When user 6603 named "Carl" taps no
    Then the bot reply contains "🙅‍♂️ Carl"
    When the user sends "/map"
    Then the bot replies
      """
      🗺️ Map pick for Alice, Bob
      Play: Nuke (100% won, 3 games)
      Avoid: Inferno (75% lost, 4 games)
      """

  Scenario: without yes-voters the map is picked for the rotation
    Given a chat with id 2602
    And the chat has recorded the shared matches
    And a user with id 6609 and first name "Captain"
    When the user sends "/rollcall_add_player Bob" mentioning user 6602 as "Bob"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/rollcall_add_player Carl" mentioning user 6603 as "Carl"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/map"
    Then the bot replies
      """
      🗺️ Map pick for Bob, Carl
      Play: Vertigo (100% won, 4 games)
      Avoid: Inferno (20% lost, 5 games)
      """

  Scenario: a lobby without three games on any map gets no pick
    Given a chat with id 2603
    And the chat has recorded the shared matches
    And a user with id 6604 and first name "Dave"
    When the user sends "/rollcall"
    Then the bot reply contains "🙋‍♂️ Dave"
    When the user sends "/map"
    Then the bot replies "No map has 3 competitive games for this lobby yet."

  Scenario: without a rollcall or rotation there is nobody to pick for
    Given a chat with id 2604
    And the chat has recorded the shared matches
    And a user with id 6604 and first name "Dave"
    When the user sends "/map"
    Then the bot replies "Nobody said yes to the latest rollcall and the rotation is empty."

  Scenario: /map works on Discord
    Given a chat with id 2605
    And the chat has recorded the shared matches
    And a Discord server "2605" named "Maps" with channel "26051" named "general"
    And Discord channel "26051" is linked to the chat
    And a user with id 6601 and first name "Alice"
    When the user sends "/rollcall"
    Then the bot reply contains "🙋‍♂️ Alice"
    When the RSVP message is remembered
    And user 6602 named "Bob" taps yes
    Then the bot reply contains "Bob"
    When Discord user "kit_cs" named "Kit" with id "260500000000000001" runs "/map" in channel "26051"
    Then Discord channel "26051" receives a bot message
      """
      **🗺️ Map pick for Alice, Bob**
      Play: Nuke (100% won, 3 games)
      Avoid: Inferno (75% lost, 4 games)
      """
