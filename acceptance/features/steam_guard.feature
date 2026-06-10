Feature: steam_guard command
  The admin submits Steam Guard codes when Steam requests one.

  Scenario: non-admins are ignored
    Given a chat with id 1900
    And a user with id 5820 and first name "Intruder"
    When the user sends "/steam_guard 12345"
    Then the bot sends no reply

  Scenario: submitting when no code is pending
    Given a chat with id 9999
    When user 9999 sends "/steam_guard 00000"
    Then the bot replies "No Steam Guard code is currently requested, or it was already provided."

  Scenario: Steam requests a code and the admin submits it
    Given a chat with id 9999
    When a Steam Guard code is requested
    Then chat 9999 receives a Steam message containing "Steam Guard code needed"
    When user 9999 sends "/steam_guard 31337"
    Then the bot replies "Steam Guard code submitted."
    And the Steam Guard callback received code "31337"
