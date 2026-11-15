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

  Scenario: linked servers offer the cross-platform commands as slash commands
    Then Discord server "10001" offers the slash commands "hi, rollcall, schedule, cancel, timezone, wingman, steam_user_id, game_history, stats, map, help, rollcall_get_players"
    And Discord server "10002" offers the slash commands "hi, rollcall, schedule, cancel, timezone, wingman, steam_user_id, game_history, stats, map, help, rollcall_get_players"

  Scenario: a Telegram rollcall is posted in every linked channel with its buttons
    When the user sends "/rollcall"
    Then the bot reply offers a "Joining" button
    And the bot reply contains "🙋‍♂️ Captain"
    And Discord channel "100011" receives a bot message containing "🙋‍♂️ Captain" with buttons "Joining, Maybe/Later, No"
    And Discord channel "100021" receives a bot message containing "🙋‍♂️ Captain" with buttons "Joining, Maybe/Later, No"

  Scenario: a Discord rollcall reaches Telegram and the other channel
    When Discord user "alice" named "Alice" with id "100010000000000002" runs "/rollcall" in channel "100011"
    Then the bot reply first line is one of
      | quote                                                  |
      | Are we rushin' in, or are we going' sneaky-beaky like? |
      | Bingo, bango, bongo, bish, bash, bosh!                 |
      | Easy peasy, lemon squeezy!                             |
      | Grab your gear and let's go!                           |
      | RUSH B DON'T STOP                                      |
    And the bot reply contains "🙋‍♂️ alice"
    And the bot reply offers a "Joining" button
    And Discord channel "100011" receives a bot message containing "🙋‍♂️ alice" with buttons "Joining, Maybe/Later, No"
    And Discord channel "100021" receives a bot message containing "🙋‍♂️ alice" with buttons "Joining, Maybe/Later, No"

  Scenario: a Discord rollcall with a time schedules it everywhere
    When Discord user "alice" named "Alice" with id "100010000000000002" runs "/rollcall" with time "3 hours" in channel "100011"
    Then the bot reply starts with "Rollcall scheduled for"
    And the bot reply contains "🙋‍♂️ alice"
    And Discord channel "100011" receives a bot message containing "Rollcall scheduled for" with buttons "I'm in, Maybe, No"
    And Discord channel "100021" receives a bot message containing "Rollcall scheduled for" with buttons "I'm in, Maybe, No"
    When Discord user "alice" named "Alice" with id "100010000000000002" runs "/cancel" in channel "100011"
    Then the bot replies "Scheduled rollcall cancelled."

  Scenario: a Discord rollcall with text that isn't a time is still a rollcall
    When Discord user "alice" named "Alice" with id "100010000000000002" runs "/rollcall" with time "lets go" in channel "100011"
    Then the bot reply offers a "Joining" button
    And Discord channel "100011" receives a bot message containing "🙋‍♂️ alice" with buttons "Joining, Maybe/Later, No"

  Scenario: a tap on Discord updates every copy
    When the user sends "/rollcall"
    Then the bot reply contains "🙋‍♂️ Captain"
    When the latest bot message is remembered
    And the latest bot message in Discord channel "100011" is remembered
    And Discord user "bob" named "Bob" with id "100010000000000003" taps "rsvp:maybe" on the remembered Discord message
    Then the remembered message is edited to contain "🤷‍♂️ bob"
    And the remembered Discord message is edited to contain "🤷‍♂️ bob"

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
    Then the bot replies "dana_cs: hi"
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
    Then the bot reply contains "erin_cs"
    And Discord channel "100011" receives a bot message containing "<@100010000000000001>" with buttons "Joining, Maybe/Later, No"
    And Discord channel "100021" receives a bot message containing "<@100010000000000001>" with buttons "Joining, Maybe/Later, No"
    When the user sends "/rollcall_remove_player discord:erin_cs"
    Then the bot replies "Poof! They're gone!"

  Scenario: a Discord user is added and removed by bare username
    Given the user is an admin of the chat
    When the user sends "/rollcall_add_player erin_cs"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/rollcall_add_player discord:erin_cs"
    Then the bot reply contains "already in the rollcall"
    When the user sends "/rollcall"
    Then Discord channel "100011" receives a bot message containing "<@100010000000000001>" with buttons "Joining, Maybe/Later, No"
    When the user sends "/rollcall_remove_player erin_cs"
    Then the bot replies "Poof! They're gone!"
    When the user sends "/rollcall_add_player nobody_cs"
    Then the bot replies "I don't know nobody_cs."

  Scenario: a wingman call from Discord reaches everyone
    When Discord user "alice" named "Alice" with id "100010000000000002" runs "/wingman" in channel "100021"
    Then the bot reply first line is one of
      | quote                                     |
      | Be my wingman!                            |
      | Be my wingman yo!                         |
      | Let's score some!                         |
      | I'm a single pringle and ready to mingle! |
    And Discord channel "100021" receives a bot message whose first line is one of
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

  Scenario: a linked person's RSVPs from both platforms count once
    Given the user is an admin of the chat
    When user 11006 sends "/hi"
    Then the bot replies "Hello to you too, User11006!"
    When the user sends "/rollcall"
    Then the bot reply contains "🙋‍♂️ Captain"
    When the latest bot message is remembered
    And the latest bot message in Discord channel "100011" is remembered
    And Discord user "finn_cs" named "Finn" with id "100010000000000006" taps "rsvp:maybe" on the remembered Discord message
    Then the remembered message is edited to contain "🤷‍♂️ finn_cs"
    When user 11006 named "User11006" taps no
    Then the remembered message is edited to contain "🙅‍♂️ User11006"
    When the user sends "/link_user @user11006 discord:finn_cs"
    Then the bot replies "Linked User11006 to Discord user finn_cs."
    When Discord user "finn_cs" named "Finn" with id "100010000000000006" taps "rsvp:yes" on the remembered Discord message
    Then the remembered message is edited to contain "🙋‍♂️ Captain User11006" and not "finn_cs"
    And the remembered Discord message is edited to contain "🙋‍♂️ Captain User11006"

  Scenario: a linked Telegram player in the rotation is pinged on Discord
    Given the user is an admin of the chat
    And a Discord server "10003" named "Server Three" with channel "100031" named "lobby" and member "jo_cs" named "Jo" with id "100030000000000001"
    And Discord channel "100031" is linked to the chat
    When user 11007 sends "/hi"
    Then the bot replies "Hello to you too, User11007!"
    When the user sends "/link_user @user11007 discord:jo_cs"
    Then the bot replies "Linked User11007 to Discord user jo_cs."
    When the user sends "/rollcall_add_player User11007" mentioning user 11007 as "User11007"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/rollcall"
    Then the bot reply links "User11007" to "tg://user?id=11007"
    And Discord channel "100031" receives a bot message containing "<@100030000000000001>" with buttons "Joining, Maybe/Later, No"
    And Discord channel "100011" receives a bot message containing "<@100030000000000001>" with buttons "Joining, Maybe/Later, No"
    When the user sends "/rollcall_remove_player User11007" mentioning user 11007 as "User11007"
    Then the bot replies "Poof! They're gone!"

  Scenario: a linked player added by Telegram username is pinged on both platforms
    Given the user is an admin of the chat
    And a Discord server "10004" named "Server Four" with channel "100041" named "lobby" and member "max_cs" named "Max" with id "100040000000000001"
    And Discord channel "100041" is linked to the chat
    When user 11008 sends "/hi"
    Then the bot replies "Hello to you too, User11008!"
    When the user sends "/link_user @user11008 discord:max_cs"
    Then the bot replies "Linked User11008 to Discord user max_cs."
    When the user sends "/rollcall_add_player @user11008" typing the username "@user11008"
    Then the bot replies "Added 1 players to rollcall."
    When the user sends "/rollcall"
    Then the bot reply contains "@user11008"
    And Discord channel "100041" receives a bot message containing "<@100040000000000001>" with buttons "Joining, Maybe/Later, No"
    When the user sends "/rollcall_remove_player @user11008" typing the username "@user11008"
    Then the bot replies "Poof! They're gone!"
