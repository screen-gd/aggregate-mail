# ADR 0114: Saved full-width reader toolbar

Date: 2026-11-01
Status: Accepted for interface layout. Device acceptance remains separate.

## Decision

Expose three toolbar arrangements in Settings > Appearance for full-width
reading: One compact row, Actions only, and Two rows. Save the choice as
`readerToolbar` in the existing local appearance preferences. New and older
preferences default to `compact`; invalid stored values use the same fallback.

Reuse the existing category and mail-action components and handlers. Only one
set of actions renders for the opened message. Actions only removes categories
while reading and restores them on close. With no categories, Two rows shows
only the action row. Narrow windows apply the same choice and wrap controls;
side-by-side reading retains its reader header.

Wide Inbox tabs show a name only for the active category, retaining accessible
names, tooltips, icons and unread counts. The narrow native picker keeps full
names. This changes presentation only, preserving the semantics in ADR 0024.

## Verification

Use appearance persistence tests and mounted navigation checks for every choice,
Settings changes, next-message navigation and close/return at phone and desktop
widths. Render actual synthetic App states with production styles to check
wrapping and enlarged text. Device and provider behavior require separate proof.
