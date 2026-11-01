# ADR 0113: Responsive mail layout

Date: 2026-10-31
Status: Accepted for interface layout. Device acceptance remains separate.

## Context

A three-column layout at tablet widths compresses mail beside an empty reader.
The category strip overflows narrow screens, and compact desktop rows leave too
little space for sender, subject and account information on phones.

## Decision

Use one reading column below 1200px. Opening mail replaces the list, and closing
returns to it through the existing navigation. Both densities use measured cards
at those widths. At 1200px and above, retain the saved reading layout.

Below 1200px, show Inbox categories in a native select with unread counts. Reuse
the existing category action, history and selection reset. Bulk selection replaces
the picker with the existing action rail. This changes the presentation in
[ADR 0024](0024-inbox-category-tabs.md), not category or archive semantics.

Keep the sidebar drawer boundary at 760px. Below it, reduce list padding and
avatar space while keeping the selection gutter stable. Preserve content-based
row heights, virtual scrolling, privacy and text scaling.

## Verification

Mounted synthetic navigation checks cover category filtering, tablet open/close,
compact phone cards and the existing desktop layout. Check actual rendered
geometry at phone, tablet and wide widths, including enlarged text and bulk
selection. Device and real-account acceptance remain separate.
