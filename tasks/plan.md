# Implementation Plan: Phase 4 — NAT Traversal

## Overview

Add NAT traversal utilities so torL can request a public port mapping from the local router. Even though the current client is leecher-only, exposing `mapPort` and `unmapPort` makes future peer-listening and DHT reachability possible. This phase focuses on UPnP IGD and NAT-PMP, the two most common router protocols.

## Scope

- **UPnP IGD** — discover the gateway via SSDP and request a port mapping via SOAP `AddPortMapping`.
- **NAT-PMP** — request a port mapping via UDP to the gateway.
- **Exclusions:** uTP/UDP hole punching, STUN/TURN, and actually listening for incoming peer connections are out of scope.

## Architecture Decisions

- **`src/nat.js` is a utility module.** It exposes `mapPort` and `unmapPort` and returns the external address/port on success.
- **Try UPnP first, then NAT-PMP.** UPnP is more common on consumer routers; NAT-PMP is common on Apple/BSD routers.
- **No external dependencies.** Implement SSDP/SOAP/NAT-PMP by hand using Node.js built-in UDP and HTTP clients.
- **Best-effort.** NAT mapping can fail silently if the router does not support it or is disabled. Return `null` on failure.
- **Tests use mocks.** A mock UPnP gateway and a mock NAT-PMP gateway respond to discovery and mapping requests so the protocol paths are deterministic.
- **Integration is optional.** Expose a `tryMapPort` helper that can be called from CLI or future download code, but do not require it for downloads.

## Task List

### Phase 4.1: UPnP IGD
- [ ] Task 1: SSDP discovery and SOAP AddPortMapping
  - **Description:** Implement SSDP M-SEARCH discovery to find the IGD control URL, parse the IGD description XML, and send a SOAP `AddPortMapping` request. Also implement `DeletePortMapping` for cleanup.
  - **Files likely touched:** `src/nat.js`, `tests/nat.test.js`, `tests/mocks/upnp-gateway.js`
  - **Acceptance criteria:**
    - A mock UPnP gateway is discovered and mapped successfully.
    - External IP and port are returned.
    - `unmapPort` cleans up the mapping.
    - All failures return `null`.
  - **Estimated scope:** Medium–Large (3–4 files)

### Checkpoint: UPnP
- [ ] `npm test` passes.
- [ ] UPnP unit/integration tests pass.

### Phase 4.2: NAT-PMP
- [ ] Task 2: NAT-PMP port mapping
  - **Description:** Implement NAT-PMP `map udp` and `map tcp` requests to the default gateway (`.1` on the local network). Parse the response and return the external address/port.
  - **Files likely touched:** `src/nat.js`, `tests/nat.test.js`, `tests/mocks/natpmp-gateway.js`
  - **Acceptance criteria:**
    - A mock NAT-PMP gateway responds to mapping requests.
    - External port and lifetime are returned.
    - Unsupported gateways return `null`.
  - **Estimated scope:** Medium (2–3 files)

### Checkpoint: NAT-PMP
- [ ] `npm test` passes.
- [ ] NAT-PMP unit/integration tests pass.

### Phase 4.3: Public API and cleanup
- [ ] Task 3: Expose `mapPort` / `unmapPort` and update docs
  - **Description:** Provide a unified `mapPort` that tries UPnP then NAT-PMP, and `unmapPort` that cleans up the same mapping. Add a CLI option or note in `AGENTS.md`.
  - **Files likely touched:** `src/nat.js`, `AGENTS.md`, `tasks/plan.md`
  - **Acceptance criteria:**
    - `mapPort` tries UPnP, then NAT-PMP.
    - `unmapPort` uses the same protocol that succeeded.
    - `AGENTS.md` documents the NAT utilities.
  - **Estimated scope:** Small (1–2 files)

### Checkpoint: Complete
- [ ] All tests pass.
- [ ] `AGENTS.md` updated.
- [ ] Code review passes.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Real routers have quirks | High | Only implement spec basics; treat failures as best-effort. |
| XML parsing for UPnP is fragile | Medium | Use simple regex/string matching; avoid full XML parser dependency. |
| NAT-PMP requires sending to the router IP | Medium | Derive gateway from the default route or hardcode `.1` in tests. |
| Tests are not portable across networks | High | All tests use local mocks; live router testing is manual only. |

## Open Questions

- Should `mapPort` default to the same port internally and externally, or allow them to differ? (Default to the same port; allow override.)
- Should the lease be short (e.g., 10 minutes) and renewed periodically? (Use a reasonable default like 1 hour; out-of-scope renewal.)
- Should the CLI call `mapPort` automatically? (No; keep it manual or future opt-in.)
