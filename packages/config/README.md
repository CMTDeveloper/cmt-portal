# @cmt/config

Workspace-only shared configuration. Consumed by every other package and `apps/portal`.

## What's here

- `tsconfig.base.json` — strict TypeScript baseline (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- `tsconfig.next.json` — Next.js extension of the base
- `eslint.config.js` — flat config with `eslint-plugin-boundaries` for feature-isolation enforcement
- `tailwind.preset.ts` — base Tailwind config wired to CSS-variable brand tokens
- `prettier.config.js` — formatting rules

## How packages consume it

```json
{
  "extends": "@cmt/config/tsconfig.next"
}
```

```js
// apps/portal/tailwind.config.ts
import preset from '@cmt/config/tailwind';
export default { presets: [preset], content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'] };
```
