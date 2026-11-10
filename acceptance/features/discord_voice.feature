Feature: the bot keeps rollcall rotation players company in Discord voice channels
  Each scenario uses its own chat and Discord server since app data persists.

  Scenario: the bot joins a rotation player in voice and leaves after them
    Given a chat with id 9501
    And a user with id 9511 and first name "Captain"
    And the user is an admin of the chat
    And a Discord server "9501" named "Voice One" with channel "95011" named "general" and member "erin_cs" named "Erin" with id "950100000000000001"
    And Discord channel "95011" is linked to the chat
    When the user sends "/rollcall_add_player discord:erin_cs"
    Then the bot replies "Added 1 players to rollcall."
    When Discord user "erin_cs" named "Erin" with id "950100000000000001" joins voice channel "95019" in server "9501"
    Then the bot joins voice channel "95019" in server "9501"
    When Discord user "erin_cs" named "Erin" with id "950100000000000001" leaves voice in server "9501"
    Then the bot leaves voice in server "9501"

  Scenario: someone outside the rotation does not bring the bot into voice
    Given a chat with id 9502
    And a user with id 9512 and first name "Captain"
    And the user is an admin of the chat
    And a Discord server "9502" named "Voice Two" with channel "95021" named "general" and member "erin_cs" named "Erin" with id "950200000000000001"
    And Discord channel "95021" is linked to the chat
    When the user sends "/rollcall_add_player discord:erin_cs"
    Then the bot replies "Added 1 players to rollcall."
    When Discord user "stranger" named "Stranger" with id "950200000000000002" joins voice channel "95029" in server "9502"
    Then the bot stays out of voice in server "9502"

  Scenario: the bot follows a rotation player to another voice channel
    Given a chat with id 9503
    And a user with id 9513 and first name "Captain"
    And the user is an admin of the chat
    And a Discord server "9503" named "Voice Three" with channel "95031" named "general" and member "erin_cs" named "Erin" with id "950300000000000001"
    And Discord channel "95031" is linked to the chat
    When the user sends "/rollcall_add_player discord:erin_cs"
    Then the bot replies "Added 1 players to rollcall."
    When Discord user "erin_cs" named "Erin" with id "950300000000000001" joins voice channel "95039" in server "9503"
    Then the bot joins voice channel "95039" in server "9503"
    When Discord user "erin_cs" named "Erin" with id "950300000000000001" joins voice channel "95038" in server "9503"
    Then the bot joins voice channel "95038" in server "9503"

  Scenario: the bot stays with the rotation player when others come and go
    Given a chat with id 9504
    And a user with id 9514 and first name "Captain"
    And the user is an admin of the chat
    And a Discord server "9504" named "Voice Four" with channel "95041" named "general" and member "erin_cs" named "Erin" with id "950400000000000001"
    And Discord channel "95041" is linked to the chat
    When the user sends "/rollcall_add_player discord:erin_cs"
    Then the bot replies "Added 1 players to rollcall."
    When Discord user "erin_cs" named "Erin" with id "950400000000000001" joins voice channel "95049" in server "9504"
    Then the bot joins voice channel "95049" in server "9504"
    When Discord user "stranger" named "Stranger" with id "950400000000000002" joins voice channel "95048" in server "9504"
    And Discord user "stranger" named "Stranger" with id "950400000000000002" leaves voice in server "9504"
    Then the bot stays in voice channel "95049" in server "9504"
