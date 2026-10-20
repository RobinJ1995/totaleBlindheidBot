Feature: Steam presence markers on rollcall, schedule and wingman tags
  Every tagged rotation player is prefixed with their Steam presence: 🟢 in CS2, 🟡 online but
  not in CS2, 🔴 offline, 😶‍🌫️ no Steam account linked. The markers are kept up to date for six
  hours after the message is sent, after which a final edit strips them.
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
    Then the bot reply contains "🟢Alice"
    And the bot reply links "Alice" to "tg://user?id=<id>1"
    And the bot reply contains "🟡Bob"
    And the bot reply links "Bob" to "tg://user?id=<id>2"
    And the bot reply contains "🔴Carol"
    And the bot reply links "Carol" to "tg://user?id=<id>3"
    And the bot reply contains "😶‍🌫️Dave"
    And the bot reply links "Dave" to "tg://user?id=<id>4"

    Examples:
      | command           | chat | id  |
      | /rollcall         | 7001 | 710 |
      | /schedule 3 hours | 7002 | 720 |
      | /wingman          | 7003 | 730 |

  Scenario Outline: <command> keeps its presence markers up to date, then strips them
    Given a chat with id <chat>
    When user <id>1 sends "/steam_user_id 7656119800000<id>1"
    Then the bot replies "Your Steam user ID(s) has been set to 7656119800000<id>1"
    When Steam mappings are refreshed
    And Steam reports user "7656119800000<id>1" online but not playing
    Given a user with id <id>0 and first name "Captain"
    When the user sends "/rollcall_add_player Alice" mentioning user <id>1 as "Alice"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "<command>"
    Then the bot reply contains "🟡Alice"
    When the latest bot message is remembered
    And Steam reports user "7656119800000<id>1" playing CS2
    Then the remembered message is edited to contain "🟢Alice"
    When Steam reports user "7656119800000<id>1" offline
    Then the remembered message is edited to contain "🔴Alice"
    When the presence markers' live window has passed
    Then the remembered message is edited to contain "Alice" without a presence marker

    Examples:
      | command           | chat | id  |
      | /rollcall         | 7011 | 740 |
      | /schedule 3 hours | 7012 | 750 |
      | /wingman          | 7013 | 760 |

  Scenario: a tap after the live window renders the RSVP message without presence markers
    Given a chat with id 7014
    And a user with id 7700 and first name "Captain"
    When the user sends "/rollcall_add_player Alice" mentioning user 7701 as "Alice"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/rollcall"
    Then the bot reply contains "😶‍🌫️Alice"
    When the latest bot message is remembered
    And the presence markers' live window has passed
    Then the remembered message is edited to contain "Alice" without a presence marker
    When user 7702 named "Bob" taps maybe
    Then the remembered message is edited to contain "🤷‍♂️ Bob" without a presence marker

  Scenario: cancelling a schedule strips its presence markers along with its buttons
    Given a chat with id 7015
    And a user with id 7800 and first name "Captain"
    When the user sends "/rollcall_add_player Alice" mentioning user 7801 as "Alice"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/schedule 3 hours"
    Then the bot reply contains "😶‍🌫️Alice"
    When the latest bot message is remembered
    And the user sends "/cancel"
    Then the bot replies "Scheduled rollcall cancelled."
    And the remembered message is edited to contain "Alice" without a presence marker
