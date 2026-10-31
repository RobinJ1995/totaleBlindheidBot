Feature: linking Telegram and Discord users
  A group admin records that a Telegram user and a Discord user are the same person. Discord people
  are named as discord:<username> in commands; a Discord user who spoke before being linked keeps
  what was recorded about them, and the Telegram name takes over once they are linked.

  Scenario: only an admin can link users
    Given a chat with id 9001
    And a user with id 9101 and first name "Member"
    When the user sends "/link_user @someone discord:someone"
    Then the bot replies "Only a group admin can link or unlink users."

  Scenario: linking needs a Telegram user and a Discord username
    Given a chat with id 9002
    And a user with id 9102 and first name "Admin"
    And the user is an admin of the chat
    When the user sends "/link_user @alice"
    Then the bot replies "Usage: /link_user @telegram_user discord:<Discord username>"
    When the user sends "/link_user @alice bob"
    Then the bot replies "Usage: /link_user @telegram_user discord:<Discord username>"

  Scenario: the Telegram user must be known
    Given a chat with id 9003
    And a user with id 9103 and first name "Admin"
    And the user is an admin of the chat
    When the user sends "/link_user @stranger discord:bob"
    Then the bot reply starts with "I don't know @stranger."

  Scenario: the Discord user must be on a linked server
    Given a chat with id 9004
    And a user with id 9104 and first name "Admin"
    And the user is an admin of the chat
    And a Discord server "9004" named "Server" with channel "90041" named "general"
    And Discord channel "90041" is linked to the chat
    When user 9114 sends "/hi"
    Then the bot reply starts with "Hello to you too"
    When the user sends "/link_user @user9114 discord:nobody"
    Then the bot reply starts with "I can't find Discord user"
    And the bot reply contains "nobody"

  Scenario: a Telegram user is linked to a Discord member who never spoke
    Given a chat with id 9005
    And a user with id 9105 and first name "Admin"
    And the user is an admin of the chat
    And a Discord server "9005" named "Server" with channel "90051" named "general" and member "bob" named "Bob" with id "900500000000000001"
    And Discord channel "90051" is linked to the chat
    When user 9115 sends "/hi"
    Then the bot reply starts with "Hello to you too"
    When the user sends "/link_user @user9115 discord:bob"
    Then the bot replies "Linked User9115 to Discord user bob."
    When the user sends "/link_user @user9115 discord:bob"
    Then the bot replies "User9115 is already linked to Discord user bob."
    When the user sends "/unlink_user @user9115"
    Then the bot replies "Unlinked User9115 from Discord user bob."
    When the user sends "/unlink_user @user9115"
    Then the bot replies "User9115 is not linked to a Discord user."

  Scenario: a Discord user who spoke keeps their rotation spot and takes the Telegram name
    Given a chat with id 9006
    And a user with id 9106 and first name "Admin"
    And the user is an admin of the chat
    And a Discord server "9006" named "Server" with channel "90061" named "general"
    And Discord channel "90061" is linked to the chat
    When Discord user "carol_cs" named "Carol" with id "900600000000000001" says "hello" in channel "90061"
    Then the bot replies "Carol: hello"
    When the user sends "/rollcall_add_player discord:carol_cs"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/rollcall_get_players"
    Then the bot reply contains "- Carol"
    When user 9116 sends "/hi"
    Then the bot reply starts with "Hello to you too"
    When the user sends "/link_user @user9116 discord:carol_cs"
    Then the bot replies "Linked User9116 to Discord user carol_cs."
    When the user sends "/rollcall_get_players"
    Then the bot reply contains "- User9116"
    When the user sends "/rollcall"
    Then the bot reply contains "User9116"
    And the bot reply links "User9116" to "tg://user?id=9116"

  Scenario: a Discord account cannot be linked to two Telegram users
    Given a chat with id 9007
    And a user with id 9107 and first name "Admin"
    And the user is an admin of the chat
    And a Discord server "9007" named "Server" with channel "90071" named "general" and member "dave" named "Dave" with id "900700000000000001"
    And Discord channel "90071" is linked to the chat
    When user 9117 sends "/hi"
    Then the bot reply starts with "Hello to you too"
    When user 9118 sends "/hi"
    Then the bot reply starts with "Hello to you too"
    When the user sends "/link_user @user9117 discord:dave"
    Then the bot replies "Linked User9117 to Discord user dave."
    When the user sends "/link_user @user9118 discord:dave"
    Then the bot replies "Discord user dave is already linked to User9117. Unlink them first with /unlink_user."
    When the user sends "/link_user @user9117 discord:eve"
    Then the bot replies "User9117 is already linked to Discord user dave. Unlink them first with /unlink_user."

  Scenario: a Discord-only player gets Steam ids and is named in the rotation
    Given a chat with id 9008
    And a user with id 9999 and first name "Admin"
    And a Discord server "9008" named "Server" with channel "90081" named "general" and member "erin" named "Erin" with id "900800000000000001"
    And the user is an admin of the chat
    And Discord channel "90081" is linked to the chat
    When the user sends "/steam_user_id discord:erin 76561198000009008"
    Then the bot replies "Steam user ID(s) for Erin has been set to 76561198000009008"
    When the user sends "/rollcall_add_player discord:erin"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/wingman"
    Then the bot reply contains "Erin"
    When the user sends "/rollcall_add_player discord:nobody"
    Then the bot reply starts with "I can't find Discord user"
    When the user sends "/rollcall_remove_player discord:erin"
    Then the bot replies "Poof! They're gone!"
