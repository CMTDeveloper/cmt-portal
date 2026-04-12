# @cmt/ui

CMT design system. Built on shadcn/ui (Radix Primitives + Tailwind), themed with CMT brand tokens.

## Public surface

- 12 shadcn components — `Button`, `Card`, `Input`, `Label`, `Form`, `Dialog`, `Sheet`, `Sonner`, `Alert`, `Skeleton`, `Avatar`, `Separator`
- `<ErrorFallback />` — shared error UI consumed by all `error.tsx` segments in `apps/portal`
- `cn()` — Tailwind class merge utility
- `styles/tokens.css` — CMT brand variables in HSL format

## Adding a new component

We use the shadcn CLI but configured to land components in this package, not in the consuming app:

```sh
cd packages/ui
pnpm dlx shadcn add <component-name>
```

The CLI reads `components.json`, downloads the upstream component, and writes it into `src/components/`. **After every `add`:**

1. Open the new file and verify the import for `cn` is correct (`'../lib/cn'`, NOT `'@/lib/utils'`)
2. Add an export to `src/index.ts`
3. Note the upstream commit hash in the PR description for drift auditing later

## Manual upgrade discipline

The shadcn model is "you own the source". Component bug fixes upstream do NOT arrive via dependency upgrade — they have to be re-applied manually. To manage drift:

- Run `pnpm dlx shadcn diff` quarterly to see what's changed upstream
- Apply only the fixes that matter; document any local divergences in this README
- Each new component PR must paste the upstream commit hash so future audits can compare

## Token theming

Colors are HSL CSS variables in `styles/tokens.css`. To rebrand, edit that file — every component picks up the change automatically because they reference `hsl(var(--primary))` etc. via the Tailwind preset in `@cmt/config/tailwind`.
