Feature: linking Telegram and Discord users
  A group admin records that a Telegram user and a Discord user are the same person. Discord people
  are named as discord:<username> in commands; a Discord user who spoke before being linked keeps
  what was recorded about them, and the Telegram name takes over once they are linked.

  Scenario: a Discord-only player gets Steam ids and is named in the rotation
    Given a chat with id 9008
    And a user with id 9999 and first name "Admin"
    And a Discord server "9008" named "Server" with channel "90081" named "general" and member "erin" named "Erin" with id "900800000000000001"
    And the user is an admin of the chat
    And Discord channel "90081" is linked to the chat
    When the user sends "/steam_user_id discord:erin 76561198000009008"
    Then the bot replies "Steam user ID(s) for Erin has been set to 76561198000009008"
