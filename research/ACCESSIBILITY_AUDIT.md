# Accessibility Audit — CareSpeak

## Fixed this pass

- **Skip link** added in `src/app/layout.tsx` targeting `#main-content`
  (tabIndex -1), styled in `src/app/globals.css`.
- **Global focus-visible outline** (3px brand) added in `globals.css`.
- **Reduced motion** — `prefers-reduced-motion: reduce` disables CSS
  animations/transitions. Note: Framer Motion inline transforms are not
  covered by CSS; a fuller pass should set `MotionConfig reducedMotion`.
- **Navbar** — language button now has `aria-label`, `aria-expanded`,
  `aria-haspopup`; mobile toggle has `aria-label`, `aria-expanded`,
  `aria-controls`; mobile panel has `id`; logo has `aria-label`; active links
  expose `aria-current="page"`.

## Remaining (P1/P2)

1. **No `aria-live` region** for gesture announcements despite README claim.
   Add a polite live region that announces the last gesture.
2. **Color contrast** — brand `#c63a22` on white passes for large text only;
   verify body text and muted `#6e6e6e` (4.5:1 check needed, UNVERIFIED).
3. **Keyboard navigation of dropdowns** — arrow-key handling missing; Escape to
   close missing; focus trap not implemented.
4. **Form labels** — some inputs rely on placeholder; verify all have
   `<label>` or `aria-label`.
5. **Focus management on route change** — Next.js does not move focus to main
   content; add focus on navigation.
6. **Screen-reader-only text** for icon-only buttons in dashboards.
7. **Touch targets** — some compact buttons below 44x44px.
8. **High-contrast / large-text** support not tested.
9. **VoiceOver/NVDA manual test** not performed (no screen-reader run in this
   environment). Mark all SR claims UNVERIFIED.
10. **WCAG 2.2 AA** full audit (axe-core run) not performed. Recommend adding
    `@axe-core/playwright` to CI.

## Honest statement

Accessibility work this pass is a P1 baseline, not a full WCAG audit. Any
claim of WCAG compliance in marketing copy is currently unsupported.