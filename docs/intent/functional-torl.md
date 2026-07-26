# torL — Functional Phase Intent

Confirmed intent for the first phase of the torL project.

## Outcome
A functional BitTorrent client that can download real torrents (single or multi-file) end-to-end.

## User
The developer iterating on this project.

## Why now
The codebase is currently a non-functional skeleton; we need a reliable foundation before adding features.

## Success criteria
1. Runs on the latest Node.js.
2. Replaces `bignum` with native `BigInt`.
3. Uses the latest `bencode`.
4. Has automated tests using the built-in `node:test` runner.
5. Includes a local mock peer/tracker for reliable, network-free tests.
6. Can download the real torrent file provided by the user.

## Constraint
Stay CommonJS and minimal; don't pull in extra frameworks beyond what's needed for this phase.

## Out of scope
Production features, performance optimization, and the Ink TUI — those are later phases after "functional" is confirmed.

## Source
Confirmed via `interview-me` on 2026-07-26.
