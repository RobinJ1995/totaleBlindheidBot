Feature: rollcall player management
  Admins manage the list of players included in a rollcall.

  Scenario: adding without arguments prompts for a name
    Given a chat with id 3001
    And a user with id 5701 and first name "Admin"
    When the user sends "/rollcall_add_player"
    Then the bot replies "Who would you like to add?"

  Scenario: argument and mention counts must match
    Given a chat with id 3002
    And a user with id 5702 and first name "Admin"
    When the user sends "/rollcall_add_player Charlie"
    Then the bot replies "1 arguments contained 0 user mentions."

  Scenario: duplicate arguments are rejected
    Given a chat with id 3003
    And a user with id 5703 and first name "Admin"
    When the user sends "/rollcall_add_player Bob Bob" mentioning 2 users
    Then the bot replies "Seems you've got some duplicate entries in there, bud!"

  Scenario: removing an unknown player
    Given a chat with id 3004
    And a user with id 5704 and first name "Admin"
    When the user sends "/rollcall_remove_player Ghost" mentioning user 888 as "Ghost"
    Then the bot replies "Who are they?"

  Scenario: removing requires a matching mention
    Given a chat with id 3006
    And a user with id 5706 and first name "Admin"
    When the user sends "/rollcall_remove_player Ghost"
    Then the bot replies "1 arguments contained 0 user mentions."

  Scenario: full add, list, duplicate-guard and remove lifecycle
    Given a chat with id 3005
    And a user with id 5705 and first name "Admin"
    When the user sends "/rollcall_get_players"
    Then the bot replies "No players in the rollcall."
    When the user sends "/rollcall_add_player Alice" mentioning user 777 as "Alice"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/rollcall_get_players"
    Then the bot reply contains "Alice"
    When the user sends "/rollcall_add_player Alice" mentioning user 777 as "Alice"
    Then the bot reply contains "already in the rollcall"
    When the user sends "/rollcall_remove_player Alice" mentioning user 777 as "Alice"
    Then the bot replies "Poof! They're gone!"
    When the user sends "/rollcall_get_players"
    Then the bot replies "No players in the rollcall."
