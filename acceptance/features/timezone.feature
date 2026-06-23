Feature: timezone command
  Users can view and set their timezone, used for scheduling.

  Scenario: viewing the default timezone
    Given a chat with id 1500
    And a user with id 5500 and first name "Tester"
    When the user sends "/timezone"
    Then the bot replies "Your current timezone is UTC"

  Scenario: an unknown timezone is rejected
    Given a chat with id 1500
    And a user with id 5501 and first name "Tester"
    When the user sends "/timezone Xyzzy"
    Then the bot replies "Invalid timezone: Xyzzy"

  Scenario: setting and persisting a timezone
    Given a chat with id 1500
    And a user with id 5502 and first name "Tester"
    When the user sends "/timezone Dublin"
    Then the bot replies "Your timezone has been set to Europe/Dublin"
    When the user sends "/timezone"
    Then the bot replies "Your current timezone is Europe/Dublin"

  Scenario Outline: setting a timezone via "<input>"
    Given a chat with id 1500
    And a user with id <user_id> and first name "Tester"
    When the user sends "/timezone <input>"
    Then the bot replies "Your timezone has been set to <expected>"

    Examples: IANA and city names (case-insensitive)
      | user_id | input         | expected         |
      | 5510    | Europe/Madrid | Europe/Madrid    |
      | 5511    | europe/madrid | Europe/Madrid    |
      | 5512    | Madrid        | Europe/Madrid    |
      | 5513    | Amsterdam     | Europe/Amsterdam |
      | 5514    | Brussels      | Europe/Brussels  |

    Examples: offset formats
      | user_id | input    | expected |
      | 5520    | UTC      | UTC      |
      | 5521    | UTC+2    | UTC+2    |
      | 5522    | utc+2    | UTC+2    |
      | 5523    | GMT+2    | UTC+2    |
      | 5524    | +02:00   | UTC+2    |
      | 5525    | UTC-5    | UTC-5    |
      | 5526    | UTC+02:00| UTC+2    |

    Examples: abbreviations
      | user_id | input | expected         |
      | 5530    | CET   | Europe/Madrid    |
      | 5531    | EST   | America/New_York |
      | 5532    | PST   | America/Los_Angeles |

  Scenario Outline: rejecting invalid timezone "<input>"
    Given a chat with id 1500
    And a user with id <user_id> and first name "Tester"
    When the user sends "/timezone <input>"
    Then the bot replies "Invalid timezone: <input>"

    Examples:
      | user_id | input |
      | 5540    | Xyzzy |
      | 5541    | asdf  |

  Scenario: setting and persisting an offset timezone
    Given a chat with id 1500
    And a user with id 5550 and first name "Tester"
    When the user sends "/timezone UTC+2"
    Then the bot replies "Your timezone has been set to UTC+2"
    When the user sends "/timezone"
    Then the bot replies "Your current timezone is UTC+2"
