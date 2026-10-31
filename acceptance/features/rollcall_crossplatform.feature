Feature: rollcalls and wingman calls across Telegram and Discord
  A rollcall or wingman call made on either platform is posted in the Telegram group and in every
  linked Discord channel. Every copy of a rollcall carries the RSVP buttons, a tap anywhere updates
  every copy, and people are pinged where they can be reached and named elsewhere.

  Background:
    Given a chat with id 10001
    And a user with id 11001 and first name "Captain"
    And a Discord server "10001" named "Server One" with channel "100011" named "general" and member "erin_cs" named "Erin" with id "100010000000000001"
    And a Discord server "10002" named "Server Two" with channel "100021" named "cs"
    And Discord channel "100011" is linked to the chat
    And Discord channel "100021" is linked to the chat

  Scenario: a Telegram rollcall is posted in every linked channel with its buttons
    When the user sends "/rollcall"
    Then the bot reply offers a "Joining" button
    And the bot reply contains "🙋‍♂️ Captain"
    And Discord channel "100011" receives a bot message containing "🙋‍♂️ Captain" with buttons "Joining, Maybe/Later, No"
    And Discord channel "100021" receives a bot message containing "🙋‍♂️ Captain" with buttons "Joining, Maybe/Later, No"

  Scenario: a tap on Discord updates every copy
    When the user sends "/rollcall"
    Then the bot reply contains "🙋‍♂️ Captain"
    When the latest bot message is remembered
    And the latest bot message in Discord channel "100011" is remembered
    And Discord user "bob" named "Bob" with id "100010000000000003" taps "rsvp:maybe" on the remembered Discord message
    Then the remembered message is edited to contain "🤷‍♂️ Bob"
    And the remembered Discord message is edited to contain "🤷‍♂️ Bob"

  Scenario: a tap on Telegram updates the Discord copies
    When the user sends "/rollcall"
    Then the bot reply contains "🙋‍♂️ Captain"
    When the latest bot message in Discord channel "100021" is remembered
    And user 11003 named "Carol" taps no
    Then the remembered Discord message is edited to contain "🙅‍♂️ Carol"

  Scenario: a linked user tapping on Discord is shown by their Telegram name
    Given the user is an admin of the chat
    When user 11004 sends "/hi"
    Then the bot reply starts with "Hello to you too"
    When the user sends "/link_user @user11004 discord:dana_cs"
    Then the bot reply starts with "I can't find Discord user"
    When Discord user "dana_cs" named "Dana D" with id "100010000000000004" says "hi" in channel "100011"
    Then the bot replies "Dana D: hi"
    When the user sends "/link_user @user11004 discord:dana_cs"
    Then the bot replies "Linked User11004 to Discord user dana_cs."
    When the user sends "/rollcall"
    Then the bot reply contains "🙋‍♂️ Captain"
    When the latest bot message in Discord channel "100011" is remembered
    And Discord user "dana_cs" named "Dana D" with id "100010000000000004" taps "rsvp:yes" on the remembered Discord message
    Then the remembered Discord message is edited to contain "🙋‍♂️ Captain User11004"

  Scenario: a Discord-only rotation player is pinged on Discord and named on Telegram
    Given the user is an admin of the chat
    When the user sends "/rollcall_add_player discord:erin_cs"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/rollcall"
    Then the bot reply contains "Erin"
    And Discord channel "100011" receives a bot message containing "<@100010000000000001>" with buttons "Joining, Maybe/Later, No"
    And Discord channel "100021" receives a bot message containing "<@100010000000000001>" with buttons "Joining, Maybe/Later, No"
    When the user sends "/rollcall_remove_player discord:erin_cs"
    Then the bot replies "Poof! They're gone!"

  Scenario: a wingman call from Telegram reaches the channels
    When the user sends "/wingman"
    Then the bot reply first line is one of
      | quote                                     |
      | Be my wingman!                            |
      | Be my wingman yo!                         |
      | Let's score some!                         |
      | I'm a single pringle and ready to mingle! |
    And Discord channel "100011" receives a bot message whose first line is one of
      | quote                                     |
      | Be my wingman!                            |
      | Be my wingman yo!                         |
      | Let's score some!                         |
      | I'm a single pringle and ready to mingle! |
