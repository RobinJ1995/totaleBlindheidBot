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

  Scenario: a location reaches Discord as a maps link
    When the user shares the location 52.3731, 4.8922
    Then Discord channel "81011" receives "📍 https://www.google.com/maps?q=52.3731,4.8922" from "Tester"

  Scenario: a venue reaches Discord with its name, address and a maps link
    When the user shares the venue "Café Hoppe" at "Spui 18" on 52.3684, 4.8897
    Then Discord channel "81011" receives "📍 Café Hoppe, Spui 18 https://www.google.com/maps?q=52.3684,4.8897" from "Tester"

  Scenario: a contact reaches Discord as name and phone number
    When the user shares the contact "Jan" "Jansen" with phone "+31612345678"
    Then Discord channel "81011" receives "👤 Jan Jansen: +31612345678" from "Tester"
    When the user shares the contact "Piet" "" with phone "+31687654321"
    Then Discord channel "81011" receives "👤 Piet: +31687654321" from "Tester"

  Scenario: dice reach Discord as their emoji and value
    When the user rolls "🎲" and gets 4
    Then Discord channel "81011" receives "🎲 4" from "Tester"
    When the user rolls "🎯" and gets 6
    Then Discord channel "81011" receives "🎯 6" from "Tester"

  Scenario: a Telegram poll reaches Discord as its question and numbered options
    When the user sends a poll "Best map?" with options "Mirage, Inferno, Nuke"
    Then Discord channel "81011" receives from "Tester"
      """
      📊 Best map?
      1. Mirage
      2. Inferno
      3. Nuke
      """
    And Discord channel "81021" receives from "Tester"
      """
      📊 Best map?
      1. Mirage
      2. Inferno
      3. Nuke
      """

  Scenario: a Discord image reaches Telegram as a photo and the other channel as a file
    When Discord user "alice" named "Alice" with id "810100000000000002" sends an image "cat.png" saying "look" in channel "81011"
    Then the bot sends a photo "cat.png" with caption "alice: look"
    And Discord channel "81021" receives a file "cat.png" from "alice" with text "look"

  Scenario: Discord gifs, videos and other files are sent the way Telegram shows them best
    When Discord user "alice" named "Alice" with id "810100000000000002" sends a gif "dance.gif" saying "" in channel "81011"
    Then the bot sends an animation "dance.gif" with caption "alice:"
    When Discord user "alice" named "Alice" with id "810100000000000002" sends a video "clip.mp4" saying "" in channel "81011"
    Then the bot sends a video "clip.mp4" with caption "alice:"
    When Discord user "alice" named "Alice" with id "810100000000000002" sends a file "rules.pdf" saying "read me" in channel "81011"
    Then the bot sends a document "rules.pdf" with caption "alice: read me"

  Scenario: a Discord poll reaches Telegram and the other channel as its question and numbered options
    When Discord user "alice" named "Alice" with id "810100000000000002" sends a poll "Tonight?" with answers "Yes, No" in channel "81011"
    Then the bot replies
      """
      alice: 📊 Tonight?
      1. Yes
      2. No
      """
    And Discord channel "81021" receives from "alice"
      """
      📊 Tonight?
      1. Yes
      2. No
      """

  Scenario: Discord stickers reach Telegram as images, Lottie ones as a note
    When Discord user "alice" named "Alice" with id "810100000000000002" sends a sticker "wave" in PNG format in channel "81011"
    Then the bot sends a photo "wave.png" with caption "alice:"
    When Discord user "alice" named "Alice" with id "810100000000000002" sends a sticker "party" in GIF format in channel "81011"
    Then the bot sends an animation "party.gif" with caption "alice:"
    When Discord user "alice" named "Alice" with id "810100000000000002" sends a sticker "dance" in Lottie format in channel "81011"
    Then the bot replies "alice: (sticker: dance)"
