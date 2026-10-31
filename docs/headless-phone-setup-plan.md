# Headless phone setup and selection layout

## Goal and approach

An administrator creates one short-lived setup link from a terminal. The phone
opens it, saves a passkey with its screen lock and enters the app without a
second approval on the host. Existing passkey sign-in and paired-browser trust
remain unchanged. Reuse authenticated localhost management, fragment
invitations, claim cookies and WebAuthn in `server/phone-passkeys.ts`.

Also restore the Projects empty-message inset and keep mail alignment stable
when selection checkboxes appear. Diagnose the delayed bulk toolbar using
synthetic mail before changing its render path. Mail rows and notifications
should size to enabled content and density/text-size settings, without blank
space reserved for hidden fields. Preserve the larger calendar event list.

Today task groups, project details, drafts and settings should share compact
content-driven spacing. Short confirmations place Undo alongside their text;
mail notifications grow only for enabled details and actions. Verify desktop
and narrow layouts with enlarged text, keyboard focus and touch targets.

## Scope and preserved behavior

- Add `scripts/phone-setup.mjs` and `npm run phone:link`. Authenticate only to an
  exact loopback origin using the host recovery password from the launch
  environment or standard input, never an argument. Never follow redirects. Accept only expected login/logout 303 responses with
  validated destinations, capture the temporary cookie and fetch the existing
  CSRF token. Bound requests and output, create one link, and attempt logout
  in cleanup after any successful login.
  Never retry an uncertain write or echo passwords, cookies or error bodies.
- Add an explicit `setup-link` action behind existing authenticated localhost,
  Origin, CSRF and confirmation guards. Keep only the invitation hash in memory.
  The link authorizes its first claim, expires in two minutes and is consumed
  once. Its cookie-bound registration retains the ten-minute claim deadline.
  Ordinary QR invitations and phone requests still require host approval.
- No credential or session before user-verified WebAuthn. Preserve origin,
  route epoch, capacity, cancellation, replay and post-verification checks.
  Administrators share setup links privately with the intended phone owner.
- Once approved, show one save-passkey step and hide comparison instructions.
  Add headless guidance to first-time help and document terminal setup.
- Correct the Projects message inset, demonstrated checkbox/toolbar
  defects and excessive spacing across the existing interface. Preserve selection scope, keyboard controls, privacy, measured row
  virtualization and all mail-operation handlers.
- Keep profiles, keys, routes, providers, release workflows and desktop behavior.
  Update affected docs, CHANGELOG and a new ADR without rewriting accepted ADRs.

## Ordered implementation and proof

1. Review this plan. Reproduce link absence, Projects inset and selection
   alignment/latency with synthetic fixtures before editing the affected path.
2. Add server regressions for link creation, one-use claims, real signed
   WebAuthn registration, missing/remote auth, replay, expiry, cancellation and
   route loss. Confirm ordinary phone requests still need host approval.
3. Add terminal-command tests for safe password input, loopback target,
   expected 303 handling, blocked redirects, failed login/CSRF, malformed links,
   deadlines, cleanup and no
   secret echo. Add client proof for the approved and expired setup states.
4. Diagnose selection latency at a reachable synthetic seam. Apply one narrow
   fix and verify the original symptom. Render before/after Projects and mail
   selection layouts at desktop and phone widths without real-mail access.
5. Run required phone-access checks serially with bounded containment, affected
   CLI/UI checks and the strict production build. Reuse unchanged proof and
   run the requested three-seat council on the exact candidate: correctness
   and security, adversarial synthetic journeys, and scope and simplicity.
   Use independent findings followed by evidence-based cross-review; any
   correction receives a changed-line recheck.
6. Update the existing PR and exact-build proof. Keep it unmerged. Smoke-test
   an immutable stage before the authorized local webapp update, preserving
   encrypted profile/key wrappers and routes. Phone-owner completion, native
   acceptance and real-provider operations remain separate proof.

## Rollback

Revert the new action, command, copy and layout corrections. Existing passkeys
remain usable; administrators can remove newly enrolled credentials through
existing controls. Restart clears unused invitations. No data migration or
new dependency is required.
