# BigPOS

Point of Sale system for Chi Dental Lab. Built with Next.js, Supabase, Tailwind CSS, and shadcn/ui.

## Stack

- **Next.js 16** (App Router)
- **Supabase** — Postgres + Auth (cookie-based session via `@supabase/ssr`)
- **Tailwind CSS v3** + **shadcn/ui** components
- **React Hook Form** + **Zod** for forms
- **Recharts** for reports

## Getting started

```bash
npm install
npm run dev
```

The app runs at <http://localhost:3000>.

## Environment

Copy `.env.local` and set:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — run the production build
- `npm run lint` — run ESLint

## Auth flow

`src/middleware.ts` runs on every request, refreshes the Supabase session via cookies, and redirects:

- unauthenticated requests (anything other than `/login`) → `/login`
- authenticated requests to `/login` → `/dashboard`

Routes under `src/app/(authenticated)/` are gated by middleware; the route group's layout wraps them with `AuthProvider` + `AppShell`.
