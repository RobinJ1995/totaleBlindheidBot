# Non-negotiable rules

These rules must *always* be checked before considering a piece of work done or pushing
changes.

- Refactors that are not strictly needed for the clean implementation of the requested
  changes go on a *separate PR* from the functional changes. The same applies for bugs
  that do not block implementation of what was requested. This doesn't mean we should
  not do refactors when they clearly improve things, or that we should hold off on
  fixing bugs that we find; we should, those changes should just go into a separate PR
  of their own.
- *Test coverage*. Every feature or bugfix should have acceptance tests covering every
  sensible scenario, and prove that without our code changes the tests fail and with
  our changes they pass. Every class, function or flow should be unit tested.
- The lint workflow has absolute authority. While it fails, you are not done.
- Once a PR is opened, any changes should be added on top as separate commits so that
  reviewers can see what changed between every review round. Rebasing or scenarios
  that require commits to be amended are obviously excluded from this rule.
- Review comments from Codex must be seen as "hey, did you think of this?", not as
  authoritative. Codex can point things out that you may have missed; it does not mean
  you must change them. Use your own judgement if something genuinely needs fixing,
  and if uncertain add the fix in a separate PR at the top of the stack so the
  maintainer can choose to merge it or leave it without blocking the work.
- Split big changes into semantically coherent, individually reviewable and shippable
  chunks and use Github PR stacks to manage them, to keep reviewing easy. A good rule
  of thumb is that every PR should ideally contain 200 or fewer changed lines *of
  production code*; test code is excluded from this metric as every individual PR
  should always be shipped with its own comprehensive test suite.
- Code comments or docs that are added must justify their existence by a genuine
  noteable decrease in cognitive effort. If a comment does not pass this test, it
  should either not exist or be trimmed down significantly. A comment or doc that says
  something in 100 words that can be said in 20 words is a defect, not thoroughness. A
  comment or doc that is likely to go stale or need updating to stay accurate after
  future not-directly-related changes is harmful.
- PR descriptions and commit messages must be *concise and to the point*; without
  theatre or essay-length descriptions; only containing a brief, objective description
  of *what* was changed.

# Code style and design choices

- Sensible immutability and early exits preferred.
- Prefer array methods (map/filter/find/some/reduce/forEach/...); reserve `for...of`
 for early exits, sequential await, or performance-critical code.
- Prefer Java-style OO, with code structured as cohesive, semantically named classes.
