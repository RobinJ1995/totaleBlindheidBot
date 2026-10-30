Feature: linking Discord channels to a Telegram group
  A group admin links Discord channels to the group by channel id. The bot checks it can see the
  channel and has what it needs there, tells both sides, and can take the link down again.

  Scenario: only an admin can link
    Given a chat with id 7001
    And a user with id 7101 and first name "Member"
    And a Discord server "7001" named "Test Server" with channel "70011" named "general"
    When the user sends "/link_chat 70011"
    Then the bot replies "Only a group admin can link or unlink Discord channels."

  Scenario: linking needs a channel id
    Given a chat with id 7002
    And a user with id 7102 and first name "Admin"
    And the user is an admin of the chat
    When the user sends "/link_chat"
    Then the bot reply starts with "Usage: /link_chat <Discord channel id>"
    When the user sends "/link_chat general"
    Then the bot reply starts with "Usage: /link_chat <Discord channel id>"

  Scenario: a channel the bot cannot see
    Given a chat with id 7003
    And a user with id 7103 and first name "Admin"
    And the user is an admin of the chat
    When the user sends "/link_chat 700399999999999999"
    Then the bot reply starts with "I can't see a Discord channel with id 700399999999999999."

  Scenario: a channel where the bot lacks permissions
    Given a chat with id 7004
    And a user with id 7104 and first name "Admin"
    And the user is an admin of the chat
    And a Discord server "7004" named "Locked Server" with channel "70041" named "secret" where the bot lacks "Send Messages, Attach Files"
    When the user sends "/link_chat 70041"
    Then the bot replies "I can see #secret on Locked Server, but I'm missing permissions there: Send Messages, Attach Files."
    And Discord channel "70041" receives nothing

  Scenario: linking a channel tells both sides
    Given a chat with id 7005
    And a user with id 7105 and first name "Admin"
    And the user is an admin of the chat
    And a Discord server "7005" named "Test Server" with channel "70051" named "general"
    When the user sends "/link_chat 70051"
    Then the bot replies "Linked to #general on Test Server."
    And Discord channel "70051" receives a bot message containing "linked to the Telegram group “Group 7005”"

  Scenario: a channel can only be linked once
    Given a chat with id 7006
    And a user with id 7106 and first name "Admin"
    And the user is an admin of the chat
    And a Discord server "7006" named "Test Server" with channel "70061" named "general"
    And Discord channel "70061" is linked to the chat
    When the user sends "/link_chat 70061"
    Then the bot replies "That channel is already linked to this group."
    Given a chat with id 7007
    And a user with id 7107 and first name "OtherAdmin"
    And the user is an admin of the chat
    When the user sends "/link_chat 70061"
    Then the bot replies "That channel is already linked to another Telegram group."

  Scenario: without webhook permission the bot still links, posting relays itself
    Given a chat with id 7008
    And a user with id 7108 and first name "Admin"
    And the user is an admin of the chat
    And a Discord server "7008" named "Plain Server" with channel "70081" named "general" where the bot lacks "Manage Webhooks"
    When the user sends "/link_chat 70081"
    Then the bot replies "Linked to #general on Plain Server. I can't manage webhooks there, so relayed messages will be posted by me with the sender's name in front."

  Scenario: unlinking one channel
    Given a chat with id 7009
    And a user with id 7109 and first name "Admin"
    And the user is an admin of the chat
    And a Discord server "7009" named "Test Server" with channel "70091" named "general"
    And Discord channel "70091" is linked to the chat
    When the user sends "/unlink_chat 70091"
    Then the bot replies "Unlinked Discord channel 70091."
    And Discord channel "70091" receives a bot message containing "no longer linked"
    And the relay webhook of channel "70091" is gone
    When the user sends "/unlink_chat 70091"
    Then the bot replies "That channel is not linked to this group."

  Scenario: unlinking without an id unlinks every channel
    Given a chat with id 7010
    And a user with id 7110 and first name "Admin"
    And the user is an admin of the chat
    And a Discord server "7010" named "Server One" with channel "70101" named "general"
    And a Discord server "7011" named "Server Two" with channel "70111" named "cs"
    And Discord channel "70101" is linked to the chat
    And Discord channel "70111" is linked to the chat
    When the user sends "/unlink_chat"
    Then the bot replies "Unlinked 2 Discord channels."
    And Discord channel "70101" receives a bot message containing "no longer linked"
    And Discord channel "70111" receives a bot message containing "no longer linked"
    When the user sends "/unlink_chat"
    Then the bot replies "No Discord channels are linked to this group."

  Scenario: only an admin can unlink
    Given a chat with id 7012
    And a user with id 7112 and first name "Member"
    When the user sends "/unlink_chat"
    Then the bot replies "Only a group admin can link or unlink Discord channels."
