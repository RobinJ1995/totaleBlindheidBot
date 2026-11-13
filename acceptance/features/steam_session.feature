Feature: Recovering a silent Steam session
  A Steam session can stay logged on while Steam no longer answers it. The bot then gives the
  session up and logs on again, so game updates resume without a restart.

  Scenario: a session Steam stopped answering is replaced and updates resume
    Given a chat with id 2901
    And a user with id 5981 and first name "Tester"
    When the user sends "/steam_user_id 76561198000009810"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000009810"
    When Steam mappings are refreshed
    And Steam stops answering the bot
    And the bot keeps asking Steam about its accounts
    Then the bot starts a new Steam session
    When Steam mappings are refreshed
    And Steam reports user "76561198000009810" playing CS2 on map "Inferno"
    Then chat 2901 receives a Steam message containing "is playing Counter-Strike"

  Scenario: a session Steam keeps answering is kept
    Given a chat with id 2902
    And a user with id 5982 and first name "Tester"
    When the user sends "/steam_user_id 76561198000009820"
    Then the bot replies "Your Steam user ID(s) has been set to 76561198000009820"
    When Steam mappings are refreshed
    And the bot keeps asking Steam about its accounts
    Then the bot keeps its Steam session
