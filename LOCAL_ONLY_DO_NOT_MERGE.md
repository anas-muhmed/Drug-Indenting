# ⚠️ This branch is local-only testing infrastructure — never merge, never deploy

`local-only/fake-db-testing` exists for one purpose: building a fake, in-memory
database (`sql.js`, a WASM-compiled SQLite build) so logic-level integration
tests can run entirely on a local machine, without needing a live connection
to the real Oracle database.

## Hard rules for this branch

1. **Never merge this branch into `main`.** Anything genuinely fixing the app
   (bugs, features, schema changes) belongs on its own branch off `main`,
   verified against the real database, and merged normally. This branch is
   not that.
2. **Never tell a remote-machine session (the one with real Oracle access)
   to pull this branch.** It has no purpose there — that machine already has
   the real database. Every remote-testing prompt in this project points at
   `main` or a specific fix branch, never this one.
3. **Never wire the fake DB into `db/pool.js` or `server.js` themselves.**
   No `if (process.env.USE_FAKE_DB)` branching in real application code —
   that would create a real risk of the fake DB silently activating in a
   real environment via a misconfigured env var. The fake DB is only ever
   imported directly by test files (via Jest's ESM module mocking) or by a
   clearly-separate local dev-only entry point, never by the app's actual
   runtime code path.
4. If you're reading this because you're about to merge, deploy, or point
   a real session at this branch: stop and check with the user first.

## Why this exists

Every DB-touching change in this project has otherwise required a full
round trip: push a branch, switch to a separate machine with real Oracle
access, pull, install, test, report back. That's slow. This branch is an
attempt to shorten the *logic verification* loop — catching obvious bugs
locally before ever needing the real database — while keeping a hard wall
between "tested against a fake" and "verified against reality." The two are
not substitutes for each other.
