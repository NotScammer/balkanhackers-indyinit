# Woven work-simulation practice (JavaScript)

Practice for the two scenarios in the invite email:

| Real scenario | Time | Practice here |
|---|---|---|
| Debugging a problem with limited information | 35 min | `debugging/`: **11 support tickets**, each with a vague report, partial logs, and code |
| Check which pages users are authorized to access | 45 min | `authorization/`: **4 programming scenarios** of increasing difficulty |

Requires Node 20+ (tested on 22). No dependencies: `npm install` is not needed.

**Read `WOVEN-NOTES.md` first.** It says what is confirmed about the real format, what is only a
rumour, and what is my guess. These scenarios are my own, modelled on that; they are *not* Woven's.

## Commands
```
node tools/run.js list                  # show scenarios
node tools/run.js timer 35              # countdown (use 45 for the auth set)

node tools/run.js debug 3               # run the check for ticket 3 against YOUR fix in debugging/03-*/src
node tools/run.js auth 2                # run the visible tests for auth scenario 2
node tools/run.js auth 2 --hidden       # run the hidden edge-case tests (only when you think you are done)
```
`npm run list`, `npm run debug -- 3` and `npm run auth -- 2 --hidden` work too.

## How to practice a debugging ticket (35 min)
1. `node tools/run.js timer 35`
2. Open the ticket: `debugging/NN-*/TICKET.md`. Read `logs/` and `src/`. Do **not** open `verify/` or `solutions/`.
3. Fix `src/`. Fill in `ANSWER.md` (the reply you would send back on the ticket).
4. Run `node tools/run.js debug N`. The check only tells you whether the behaviour is right, not why.
5. After the timer, compare with `solutions/debugging/NOTES.md`.

`ANSWER.md` is the part I would take most seriously. Woven's reviewers are people reading what you wrote.
Ticket 11 is deliberately under-specified: the right outcome is to **send the ticket back** with sharp
questions *and* make the next failure self-explanatory.

## How to practice an authorization scenario (45 min)
Do 01 + 02 as one 45-minute set (closest to a real sitting), then 03 + 04 as a harder set later.
Implement `authorization/NN-*/src/index.js` from the README, run the visible tests, write
`NOTES.md` (assumptions, edge cases, what you would test next), then run `--hidden`.
Hidden tests live in `_hidden/` and only cover behaviour stated in the README.

## Suggested schedule before Friday
- **Today:** tickets 1, 2, 4 (timed). Auth 01 untimed to learn the shape.
- **Tomorrow:** tickets 3, 5, 9, 11 (timed). Auth 01 + 02 as a timed 45-minute set.
- **Thursday:** one full dress rehearsal: random ticket (35) -> 10-minute break -> auth 03 + 04 (45).
- **Friday:** do not cram. Re-read your own `ANSWER.md` files and `WOVEN-NOTES.md`.

## Layout
```
debugging/NN-name/   TICKET.md  ANSWER.md  logs/  src/  verify/        (verify = the check; run it via the runner)
authorization/NN-name/ README.md  src/index.js  test/visible.test.js
_hidden/             hidden edge-case tests for authorization (don't open until done)
solutions/           reference fixes + debugging/NOTES.md (spoilers)
tools/run.js         runner, timer, selftest
```
# balkanhackers-indyinit
