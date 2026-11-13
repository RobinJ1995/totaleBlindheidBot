Feature: Leetify stats in end-of-game messages
  Once Leetify has a finished match, its announcement is edited to add a scoreboard of the
  chat's players and a few highlights: aces and 4ks, flashing teammates eight times or more,
  and runs of three or more premier or competitive wins or losses. A player who is not on
  Leetify keeps the run from their recorded matches. Leetify is asked a few times per match,
  and accounts that are not on Leetify are not asked about again.

  Scenario: a match Leetify has gets a scoreboard and highlights
    Given a chat with id 2501
    And a user with id 6501 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002501"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002501"
    Given Steam account "76561198000002501" is on Leetify
    And Leetify has "matchmaking" match "kit-1" that ended 120 minutes ago at 13-5 for team 2, with these players
      | steam_id          |
      | 76561198000002501 |
    And Leetify has "matchmaking_competitive" match "kit-2" that ended 60 minutes ago at 13-9 for team 2, with these players
      | steam_id          |
      | 76561198000002501 |
    And Leetify has "matchmaking" match "kit-3" that ended 0 minutes ago at 13-7 for team 2, with these players
      | steam_id          | team | kills | deaths | assists | adr    | aces | 4ks | team_flashes |
      | 76561198000002501 | 2    | 22    | 5      | 3       | 125.71 | 1    | 2   | 8            |
      | 76561198000009001 | 3    | 30    | 9      | 1       | 140    | 2    | 0   | 20           |
    When Steam mappings are refreshed
    And Steam reports user "76561198000002501" playing CS2 as "Kit" with score "13-7" on map "Inferno"
    And Steam reports user "76561198000002501" stopped playing
    Then chat 2501 eventually receives a new Steam message reading
      """
      🏆 Kit won a game on Inferno (Competitive): 1️⃣3️⃣-7️⃣
      """
    And the Steam message in chat 2501 is edited to read
      """
      🏆 Kit won a game on Inferno (Competitive): 1️⃣3️⃣-7️⃣
      💥 Kit: ace, 2 4ks
      😵 Kit flashed teammates 8 times
      🔥 Kit: 3 wins in a row
      Player       K   D   A ADR
      Kit         22   5   3 126
      """

  Scenario: a match Leetify gets later is added then, without highlights that are not notable
    Given a chat with id 2502
    And a user with id 6502 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002502"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002502"
    Given Steam account "76561198000002502" is on Leetify
    And Leetify has "matchmaking" match "late-1" that ended 60 minutes ago at 5-13 for team 2, with these players
      | steam_id          |
      | 76561198000002502 |
    When Steam mappings are refreshed
    And Steam reports user "76561198000002502" playing CS2 as "Kit" with score "7-13" on map "Inferno"
    And Steam reports user "76561198000002502" stopped playing
    Then chat 2502 eventually receives a new Steam message reading
      """
      ☠️ Kit lost a game on Inferno (Competitive): 7️⃣-1️⃣3️⃣
      """
    When Leetify has "matchmaking" match "late-2" that ended 0 minutes ago at 7-13 for team 2, with these players
      | steam_id          | kills | deaths | assists | adr | team_flashes |
      | 76561198000002502 | 9     | 17     | 4       | 61  | 7            |
    Then the Steam message in chat 2502 is edited to read
      """
      ☠️ Kit lost a game on Inferno (Competitive): 7️⃣-1️⃣3️⃣
      Player       K   D   A ADR
      Kit          9  17   4  61
      """

  Scenario: a match Leetify times at its start is recognised
    Given a chat with id 2509
    And a user with id 6509 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002509"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002509"
    Given Steam account "76561198000002509" is on Leetify
    When Steam mappings are refreshed
    And Steam reports user "76561198000002509" playing CS2 as "Kit" with score "10-13" on map "Cache"
    And Steam reports user "76561198000002509" stopped playing
    Then chat 2509 eventually receives a new Steam message reading
      """
      ☠️ Kit lost a game on Cache (Competitive): 1️⃣0️⃣-1️⃣3️⃣
      """
    When the matches of chat 2509 turn out to have started 40 minutes earlier
    And Leetify has "matchmaking" match "from-start" that ended 38 minutes ago at 10-13 for team 2, with these players
      | steam_id          | kills | deaths | assists | adr |
      | 76561198000002509 | 15    | 18     | 6       | 77  |
    Then the Steam message in chat 2509 is edited to read
      """
      ☠️ Kit lost a game on Cache (Competitive): 1️⃣0️⃣-1️⃣3️⃣
      Player       K   D   A ADR
      Kit         15  18   6  77
      """

  Scenario: one player on Leetify gets the whole party its stats, the other keeps their recorded streak
    Given a chat with id 2503
    When user 6503 sends "/steam_user_id 76561198000002503"
    Then the bot reply contains "76561198000002503"
    When user 6504 sends "/steam_user_id 76561198000002504"
    Then the bot reply contains "76561198000002504"
    Given chat 2503 already has these finished matches
      | player | name  | mode        | map    | score | minutes_ago |
      | 6503   | Alpha | Competitive | Mirage | 13-5  | 120         |
      | 6503   | Alpha | Premier     | Nuke   | 13-9  | 60          |
      | 6504   | Bravo | Competitive | Mirage | 13-5  | 120         |
      | 6504   | Bravo | Premier     | Nuke   | 13-9  | 60          |
    Given Steam account "76561198000002504" is on Leetify
    And Leetify has "matchmaking" match "duo-1" that ended 0 minutes ago at 13-10 for team 2, with these players
      | steam_id          | kills | deaths | assists | adr |
      | 76561198000002503 | 12    | 16     | 5       | 68  |
      | 76561198000002504 | 25    | 14     | 2       | 99  |
    When Steam mappings are refreshed
    And Steam reports party "duo" member "76561198000002503" playing CS2 as "Alpha" with score "13-10" on map "Vertigo"
    And Steam reports party "duo" member "76561198000002504" playing CS2 as "Bravo" with score "13-10" on map "Vertigo"
    And Steam reports user "76561198000002503" stopped playing
    And Steam reports user "76561198000002504" stopped playing
    Then the Steam message in chat 2503 is edited to read
      """
      🏆 Bravo and Alpha won a game on Vertigo (Competitive): 1️⃣3️⃣-1️⃣0️⃣
      🔥 Alpha: 3 wins in a row
      Player       K   D   A ADR
      Bravo       25  14   2  99
      Alpha       12  16   5  68
      """
    And Leetify is asked for the matches of Steam account "76561198000002503" 1 times and no more

  Scenario: a teammate whose match is recorded later keeps the stats on the announcement
    Given a chat with id 2507
    When user 6507 sends "/steam_user_id 76561198000002507"
    Then the bot reply contains "76561198000002507"
    When user 6508 sends "/steam_user_id 76561198000002508"
    Then the bot reply contains "76561198000002508"
    Given Steam account "76561198000002507" is on Leetify
    And Leetify has "matchmaking" match "late-duo" that ended 0 minutes ago at 13-10 for team 2, with these players
      | steam_id          | kills | deaths | assists | adr |
      | 76561198000002507 | 12    | 16     | 5       | 68  |
      | 76561198000002508 | 25    | 14     | 2       | 99  |
    When Steam mappings are refreshed
    And Steam reports party "duo" member "76561198000002507" playing CS2 as "Alpha" with score "13-10" on map "Vertigo"
    And Steam reports party "duo" member "76561198000002508" playing CS2 as "Bravo" with score "13-10" on map "Vertigo"
    And Steam reports user "76561198000002507" stopped playing
    Then the Steam message in chat 2507 is edited to read
      """
      🏆 Alpha won a game on Vertigo (Competitive): 1️⃣3️⃣-1️⃣0️⃣
      Player       K   D   A ADR
      Alpha       12  16   5  68
      """
    When Steam reports user "76561198000002508" stopped playing
    Then the Steam message in chat 2507 is edited to read
      """
      🏆 Bravo and Alpha won a game on Vertigo (Competitive): 1️⃣3️⃣-1️⃣0️⃣
      Player       K   D   A ADR
      Bravo       25  14   2  99
      Alpha       12  16   5  68
      """

  Scenario: an account that is not on Leetify is asked about once, however many matches it plays
    Given a chat with id 2505
    And a user with id 6505 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002505"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002505"
    When Steam mappings are refreshed
    And Steam reports user "76561198000002505" playing CS2 as "Kit" with score "13-7" on map "Inferno"
    And Steam reports user "76561198000002505" stopped playing
    Then chat 2505 eventually receives a new Steam message containing "Kit won a game on Inferno"
    When Steam reports user "76561198000002505" playing CS2 as "Kit" with score "13-5" on map "Mirage"
    And Steam reports user "76561198000002505" stopped playing
    Then chat 2505 eventually receives a new Steam message containing "Kit won a game on Mirage"
    And Leetify is asked for the matches of Steam account "76561198000002505" 1 times and no more
    And the Steam message in chat 2505 is not edited

  Scenario: a match Leetify never gets is asked for three times, then given up on
    Given a chat with id 2506
    And a user with id 6506 and first name "Kit"
    When the user sends "/steam_user_id 76561198000002506"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000002506"
    Given Steam account "76561198000002506" is on Leetify
    When Steam mappings are refreshed
    And Steam reports user "76561198000002506" playing CS2 as "Kit" with score "13-7" on map "Inferno"
    And Steam reports user "76561198000002506" stopped playing
    Then chat 2506 eventually receives a new Steam message containing "Kit won a game on Inferno"
    And Leetify is asked for the matches of Steam account "76561198000002506" 3 times and no more
    And the Steam message in chat 2506 is not edited
