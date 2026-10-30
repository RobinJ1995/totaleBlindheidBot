Feature: relaying photos, files and stickers between Telegram and Discord
  Files are re-uploaded on the other side. What the other side cannot show, or what is too big to
  carry across, becomes a short placeholder instead.

  Background:
    Given a chat with id 8101
    And a user with id 8201 and first name "Tester"
    And a Discord server "8101" named "Server One" with channel "81011" named "general"
    And a Discord server "8102" named "Server Two" with channel "81021" named "cs"
    And Discord channel "81011" is linked to the chat
    And Discord channel "81021" is linked to the chat

  Scenario: a Telegram photo with a caption reaches every linked channel
    When the user sends a photo "photo.jpg" with caption "look at this"
    Then Discord channel "81011" receives a file "photo.jpg" from "Tester" with text "look at this"
    And Discord channel "81021" receives a file "photo.jpg" from "Tester" with text "look at this"

  Scenario: a Telegram document keeps its name
    When the user sends a document "notes.pdf"
    Then Discord channel "81011" receives a file "notes.pdf" from "Tester" with text ""

  Scenario: a file too big for the bot to download becomes a placeholder
    When the user sends a document "big.zip" of 25 MB
    Then Discord channel "81011" receives "[big.zip, 25 MB]" from "Tester"

  Scenario: static stickers travel, animated ones become their emoji
    When the user sends a static sticker
    Then Discord channel "81011" receives a file "sticker.webp" from "Tester" with text ""
    When the user sends an animated sticker "😀"
    Then Discord channel "81011" receives "😀 (animated sticker)" from "Tester"

  Scenario: voice messages are noted, not relayed
    When the user sends a voice message
    Then Discord channel "81011" receives "[voice message]" from "Tester"
