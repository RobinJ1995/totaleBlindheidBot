Feature: rollcall command
  The bot rallies the troops with a random battle cry.

  Scenario: rollcall replies with one of the known quotes
    Given a chat with id 1200
    And a user with id 5200 and first name "Tester"
    When the user sends "/rollcall"
    Then the bot reply first line is one of
      | quote                                                  |
      | Are we rushin' in, or are we going' sneaky-beaky like? |
      | Bingo, bango, bongo, bish, bash, bosh!                 |
      | Easy peasy, lemon squeezy!                             |
      | Grab your gear and let's go!                           |
      | RUSH B DON'T STOP                                      |
