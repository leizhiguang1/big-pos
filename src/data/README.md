# data/

The ONLY place application code talks to Supabase. One module per aggregate.

- **Reads** are server-side query functions called from Server Components, using
  the SSR client (`@/lib/supabase/server` → `await createClient()`, RLS-aware).
- **Writes** are Server Actions (`'use server'`) that gate via
  `requirePermission(...)`, mutate through the admin client
  (`@/lib/supabase/admin`), then call `revalidatePath(...)` and return an
  `ActionResult` (`{ ok: true } | { ok: false; error }`).
- Components must never import `@/lib/supabase` directly — they call these
  functions/actions (reads as props from Server Components, writes as actions).

A `'use server'` file may export ONLY async functions — keep shared types in a
plain module (or `export type`, which is erased) and import value helpers
(e.g. void) from their own files rather than re-exporting them here.

Invoices are implemented (`invoices.ts` reads, `invoice-actions.ts` writes) as of
Plan 3. Other aggregates follow the same shape as they are migrated.
