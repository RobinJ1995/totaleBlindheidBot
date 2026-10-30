Feature: GitHub commit notifications
  When new commits are pushed, the bot announces them to chats that opted in via
  /github_notify, and leaves other chats alone.

  Scenario: a new commit is announced to an opted-in chat
    Given a chat with id 7001
    And a user with id 5970 and first name "Tester"
    When the user sends "/github_notify on"
    Then the bot replies "GitHub notifications for this chat have been turned on."
    When a commit "c0ffee1" with message "Add acceptance tests" is pushed to GitHub
    Then chat 7001 receives a GitHub notification containing "New commit"
    And chat 7001 receives a GitHub notification containing "Add acceptance tests"

  Scenario: chats that did not opt in receive nothing
    Given a chat with id 7002
    And a user with id 5971 and first name "Tester"
    When a commit "deadbee" with message "Silent change" is pushed to GitHub
    Then no GitHub notification is posted to chat 7002

  Scenario: polls with nothing new are conditional requests
    # An unchanged repo must answer 304, which GitHub does not charge against the
    # hourly rate limit — that is what keeps a 5-minute poller affordable.
    Given the bot has established its GitHub baseline
    When the GitHub request counters are reset
    Then GitHub answers at least one poll with "304 Not Modified"

  Scenario: a rate-limited poller backs off and still announces once it recovers
    Given a chat with id 7003
    And a user with id 5972 and first name "Tester"
    And the bot has established its GitHub baseline
    When the user sends "/github_notify on"
    Then the bot replies "GitHub notifications for this chat have been turned on."
    When GitHub rejects the next 2 requests with a rate limit and retry-after 2
    And a commit "l1m1ted" with message "Survived the rate limit" is pushed to GitHub
    Then chat 7003 receives a GitHub notification containing "Survived the rate limit"
