Feature: /online shows who in the chat is on Steam
  Players in CS2 come first with their map, mode and score, then those online elsewhere on
  Steam. Offline players and those without a linked Steam account are left out.
  Each scenario uses its own chat, users and Steam ids since app data persists across scenarios.

  Scenario: /online lists who is playing, then who is online
    Given a chat with id 7101
    When user 7111 sends "/steam_user_id 76561198000071111"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000071111"
    When user 7112 sends "/steam_user_id 76561198000071112"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000071112"
    When user 7113 sends "/steam_user_id 76561198000071113"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000071113"
    When user 7115 sends "/steam_user_id 76561198000071115"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000071115"
    When Steam mappings are refreshed
    And Steam reports user "76561198000071112" online but not playing
    And Steam reports user "76561198000071113" offline
    And Steam reports user "76561198000071115" playing CS2
    And Steam reports user "76561198000071111" playing CS2 with score "10-5" on map "de_dust2"
    Then chat 7101 receives a Steam message containing "is playing Counter-Strike"
    When user 7114 sends "/online"
    Then the bot replies
      """
      🟢 User7111 is playing de_dust2 (Competitive): 1️⃣0️⃣-5️⃣
      🟢 User7115 is playing Counter-Strike
      🟡 User7112 is online
      """
    And the bot reply has "User7111" in bold
    And the bot reply has "User7112" in bold

  Scenario: /online says so when nobody is online
    Given a chat with id 7102
    When user 7121 sends "/steam_user_id 76561198000071121"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000071121"
    When Steam mappings are refreshed
    And Steam reports user "76561198000071121" offline
    When user 7122 sends "/online"
    Then the bot replies "Nobody is on Steam right now."

  Scenario: /online works as a slash command on Discord
    Given a chat with id 7103
    And a Discord server "7103" named "Online" with channel "71031" named "general"
    And Discord channel "71031" is linked to the chat
    When user 7131 sends "/steam_user_id 76561198000071131"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000071131"
    When Steam mappings are refreshed
    And Steam reports user "76561198000071131" playing CS2 with score "3-2" on map "Inferno"
    Then chat 7103 receives a Steam message containing "is playing Counter-Strike"
    When Discord user "kit_cs" named "Kit" with id "710300000000000001" runs "/online" in channel "71031"
    Then Discord channel "71031" receives a bot message
      """
      🟢 **User7131** is playing Inferno (Competitive): 3️⃣-2️⃣
      """
