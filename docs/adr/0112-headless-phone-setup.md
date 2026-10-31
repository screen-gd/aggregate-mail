# ADR 0112: One-time headless phone setup links

Status: Proposed implementation, pending independent review.

## Decision

Extend ADR 0082 and ADR 0096 with an explicit authenticated localhost
`setup-link` action. Its invitation grants the first claimant registration
approval, replacing the second host-screen approval for that invitation only.
Ordinary QR invitations and phone-initiated requests keep matching-code approval.

Use the existing 256-bit fragment token, hash-only memory state, two-minute
invitation expiry and Secure HttpOnly claim cookie. Consume both the token and
its authorization on claim. Complete registration within the existing ten-minute
deadline. Require user-verified WebAuthn before saving any credential or issuing
a browser session. Keep cancellation, capacity, replay, route epoch and
post-verification checks. No schema or key-storage change is needed.

`npm run phone:link` authenticates with the local recovery passphrase from the
secure launch environment or explicitly piped stdin. It never accepts password
arguments, follows redirects, forwards credentials, retries uncertain writes or
prints server error bodies. Validate the known login/logout 303 destinations,
read the authenticated CSRF value, create one link and attempt logout in cleanup.
The command requires an already configured private Phone access route.

## Consequences and proof

Administrators can connect a phone without a host display. Anyone holding an
unused link may claim its approval, so share it privately with the intended
recipient. Claiming still requires a passkey and screen-lock verification.
Restart discards unused invitations. Removing a newly registered device uses
the existing revocation controls. Existing paired-browser trust is unchanged.

Synthetic HTTP tests cover authorization, one-use claims, expiry, cancellation,
route loss and signed WebAuthn. CLI tests exercise actual local login/logout and
bounded failure paths. Native phone prompts and real-provider operations remain
separate acceptance checks.
