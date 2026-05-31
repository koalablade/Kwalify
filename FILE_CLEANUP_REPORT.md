# File Cleanup Report
_Generated from real code inspection — not estimated._

---

## Section 1 — Unused Source Files

| File | Why Unused | Safe to Delete? | What Breaks If Removed |
|---|---|---|---|
| `artifacts/api-server/src/lib/.gitkeep` | Empty placeholder for empty directory | Yes | Nothing |
| `artifacts/api-server/src/middlewares/.gitkeep` | Empty placeholder — no middleware files exist | Yes | Nothing |
| `artifacts/kwalify/src/hooks/use-mobile.tsx` | Not imported anywhere in application code | Yes | Nothing |

---

## Section 2 — Unused shadcn/ui Components

These 43 components are installed and available but never imported by any page or kwalify component. In a Vite/React app, tree-shaking removes them from the production bundle automatically, so they add **zero bundle size in production**. They are safe to delete to reduce clutter but carry no performance cost if left.

| Component | Imported By | Safe to Delete? |
|---|---|---|
| `accordion.tsx` | Nothing | Yes |
| `alert-dialog.tsx` | Nothing | Yes |
| `alert.tsx` | Nothing | Yes |
| `aspect-ratio.tsx` | Nothing | Yes |
| `avatar.tsx` | Nothing | Yes |
| `breadcrumb.tsx` | Nothing | Yes |
| `button-group.tsx` | Nothing | Yes |
| `calendar.tsx` | Nothing | Yes |
| `card.tsx` | Nothing | Yes |
| `carousel.tsx` | Nothing | Yes |
| `chart.tsx` | Nothing | Yes |
| `checkbox.tsx` | Nothing | Yes |
| `collapsible.tsx` | Nothing | Yes |
| `command.tsx` | Nothing | Yes |
| `context-menu.tsx` | Nothing | Yes |
| `dialog.tsx` | Nothing | Yes |
| `drawer.tsx` | Nothing | Yes |
| `empty.tsx` | Nothing | Yes |
| `field.tsx` | Nothing | Yes |
| `form.tsx` | Nothing | Yes |
| `hover-card.tsx` | Nothing | Yes |
| `input-group.tsx` | Nothing | Yes |
| `input-otp.tsx` | Nothing | Yes |
| `input.tsx` | Nothing | Yes |
| `item.tsx` | Nothing | Yes |
| `kbd.tsx` | Nothing | Yes |
| `label.tsx` | Nothing | Yes |
| `menubar.tsx` | Nothing | Yes |
| `navigation-menu.tsx` | Nothing | Yes |
| `pagination.tsx` | Nothing | Yes |
| `popover.tsx` | Nothing | Yes |
| `radio-group.tsx` | Nothing | Yes |
| `resizable.tsx` | Nothing | Yes |
| `scroll-area.tsx` | Nothing | Yes |
| `select.tsx` | Nothing | Yes |
| `separator.tsx` | Nothing | Yes |
| `sheet.tsx` | Nothing | Yes |
| `sidebar.tsx` | Nothing | Yes |
| `skeleton.tsx` | Nothing | Yes |
| `sonner.tsx` | Nothing | Yes |
| `spinner.tsx` | Nothing | Yes |
| `switch.tsx` | Nothing | Yes |
| `table.tsx` | Nothing | Yes |
| `tabs.tsx` | Nothing | Yes |
| `toggle.tsx` | Nothing | Yes |
| `toggle-group.tsx` | Nothing | Yes |

**Components actually used** (do NOT delete):

| Component | Used By |
|---|---|
| `badge.tsx` | `history-card.tsx` |
| `button.tsx` | `dashboard.tsx`, `sync-status.tsx`, `error-state.tsx`, `login.tsx`, `history.tsx` |
| `dropdown-menu.tsx` | `dashboard.tsx` |
| `progress.tsx` | `sync-status.tsx` |
| `slider.tsx` | `length-selector.tsx` |
| `textarea.tsx` | `vibe-input.tsx` |
| `toast.tsx` + `toaster.tsx` | `App.tsx` |
| `tooltip.tsx` | `App.tsx` (via `TooltipProvider`) |

---

## Section 3 — Unused npm Dependencies

### `@workspace/kwalify` (Frontend)

| Package | Why Unused | Safe to Remove? |
|---|---|---|
| `@hookform/resolvers` | No react-hook-form usage in any component | Yes |
| `react-hook-form` | Not imported anywhere | Yes |
| `next-themes` | Not imported anywhere (dark class applied directly in main.tsx) | Yes |
| `recharts` | Not imported anywhere | Yes |
| `react-icons` | Not imported (lucide-react used instead) | Yes |
| `react-day-picker` | Not imported anywhere | Yes |
| `date-fns` | Not imported anywhere | Yes |
| `embla-carousel-react` | Not imported anywhere | Yes |
| `input-otp` | Not imported anywhere | Yes |
| `vaul` | Not imported anywhere | Yes |
| `cmdk` | Not imported anywhere | Yes |
| `sonner` | Not imported (shadcn toast used instead) | Yes |
| `react-resizable-panels` | Not imported anywhere | Yes |

### `@workspace/api-server` (Backend)

| Package | Why Unused | Safe to Remove? |
|---|---|---|
| `cookie-parser` | Installed as dependency but `app.use(cookieParser())` is never called in `app.ts` | Yes |

---

## Section 4 — Dead Code

| Location | Issue | Impact |
|---|---|---|
| `artifacts/api-server/src/routes/generate.ts` — NEUTRAL_PROFILE constant | Declared but only used inside catch block for emotion engine failure. Low risk. | Cosmetic |
| `artifacts/kwalify/src/App.tsx` — OAUTH_ERROR_MESSAGES map | Maps `missing_code` but backend sends `no_code`. The key never matches; fallback generic message shown instead. | Minor UX bug |

---

## Safe-Delete List (in recommended order)

```
# Placeholders — delete first, zero risk
artifacts/api-server/src/lib/.gitkeep
artifacts/api-server/src/middlewares/.gitkeep

# Unused hook
artifacts/kwalify/src/hooks/use-mobile.tsx

# Unused shadcn components (only if you want a clean tree)
# — no bundle impact, optional cleanup only
artifacts/kwalify/src/components/ui/accordion.tsx
artifacts/kwalify/src/components/ui/alert-dialog.tsx
... (see full list above)
```

**Recommended action:** Delete placeholders and `use-mobile.tsx` now. Leave shadcn components in place — they're standard scaffolding and removing them requires also removing their Radix deps, which risks breaking peer dependencies. Fix the `no_code` / `missing_code` key mismatch in `App.tsx`.
