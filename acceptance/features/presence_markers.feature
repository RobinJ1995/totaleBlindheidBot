Feature: Steam presence markers on rollcall, schedule and wingman tags
  Every tagged rotation player is prefixed with their Steam presence: 🟢 in CS2, 🟡 online but
  not in CS2, 🔴 offline. Players without a linked Steam account are tagged without a marker.
  Each example uses its own chat, users and Steam ids since app data persists across scenarios.

  Scenario Outline: <command> prefixes each tag with the player's presence
    Given a chat with id <chat>
    When user <id>1 sends "/steam_user_id 7656119800000<id>1"
    Then the bot replies "Your Steam user ID(s) has been set to 7656119800000<id>1"
    When user <id>2 sends "/steam_user_id 7656119800000<id>2"
    Then the bot replies "Your Steam user ID(s) has been set to 7656119800000<id>2"
    When user <id>3 sends "/steam_user_id 7656119800000<id>3"
    Then the bot replies "Your Steam user ID(s) has been set to 7656119800000<id>3"
    When Steam mappings are refreshed
    And Steam reports user "7656119800000<id>2" online but not playing
    And Steam reports user "7656119800000<id>3" offline
    And Steam reports user "7656119800000<id>1" playing CS2
    Then chat <chat> receives a Steam message containing "is playing Counter-Strike"
    Given a user with id <id>0 and first name "Captain"
    When the user sends "/rollcall_add_player Alice" mentioning user <id>1 as "Alice"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/rollcall_add_player Bob" mentioning user <id>2 as "Bob"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/rollcall_add_player Carol" mentioning user <id>3 as "Carol"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/rollcall_add_player Dave" mentioning user <id>4 as "Dave"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "<command>"
    Then the bot reply contains "🟢 [Alice](tg://user?id=<id>1)"
    And the bot reply contains "🟡 [Bob](tg://user?id=<id>2)"
    And the bot reply contains "🔴 [Carol](tg://user?id=<id>3)"
    And the bot reply contains "[Dave](tg://user?id=<id>4)"
    And the bot reply does not contain "🟢 [Dave]"
    And the bot reply does not contain "🟡 [Dave]"
    And the bot reply does not contain "🔴 [Dave]"

    Examples:
      | command           | chat | id  |
      | /rollcall         | 7001 | 710 |
      | /schedule 3 hours | 7002 | 720 |
      | /wingman          | 7003 | 730 |
