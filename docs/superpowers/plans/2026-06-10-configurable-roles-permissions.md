# Configurable Roles & Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `admin`/`staff` role with a configurable roles + permissions system: custom-named roles, a per-role permission checklist, and a protected built-in Super Admin tier.

**Architecture:** Two new tables (`roles`, `role_permissions`) plus `profiles.role_id`. Permissions are a fixed list of string constants shipped in code. Access decisions become capability checks: `hasPermission('x')` on the client (UI gating) and `requirePermission('x')` on the server (the real boundary). Super Admin is an `is_system` role treated as "has every permission." Pure logic (permission lookup, edit rules, lockout guard) is unit-tested with vitest; integration code (server actions, React components, DB) is verified with `npm run build` + a manual checklist.

**Tech Stack:** Next.js (App Router) + React client components, Supabase (Postgres + Auth, no RLS yet — server actions are the boundary), TypeScript, vitest. DB migrations are applied through the `big-pos-supabase` MCP server (`apply_migration` / `execute_sql`) — there is no local `supabase/` CLI setup.

**Scope note (phase 1):** This plan builds the RBAC engine, migrates data, rewires the three gates that exist today (manage employees, void/restore invoice, edit finalized invoice), and ships the Super-Admin-only role-management UI + employee role assignment. The full permission list (18 flags) is defined, seeded, and assignable. Wiring the remaining flags (`createProduct`, `editCustomer`, `deleteService`, etc.) to their buttons on the Products/Customers/Services pages is **Phase 2**, listed at the end — those flags are inert until then.

---

## File Structure

**New files**
- `src/lib/permissions.ts` — permission constants, display groups, and pure helpers (`permissionGranted`, `wouldRemoveLastSuperadmin`).
- `src/lib/permissions.test.ts` — unit tests for the pure helpers.
- `src/lib/auth/require-permission.ts` — `requirePermission()` + `requireSuperadmin()` server gates (replaces `require-admin.ts`).
- `src/lib/auth/role-actions.ts` — `createRole` / `updateRole` / `deleteRole` server actions (Super-Admin gated).
- `src/app/(authenticated)/settings/roles/page.tsx` — Super-Admin-only roles page.
- `src/components/roles/RolesManager.tsx` — list + per-role checklist editor.

**Modified files**
- `src/lib/database.types.ts` — add `Role`, `RolePermission`, `Permission`; `profiles.role_id`; register new tables.
- `src/lib/invoice-permissions.ts` (+ `.test.ts`) — `canEditInvoice` now takes a `has(permission)` predicate.
- `src/lib/auth/employee-actions.ts` — `roleId` instead of role string; `requirePermission('manageEmployees')`; last-Super-Admin guard.
- `src/lib/invoices/void-actions.ts` — `requirePermission('voidInvoice')`.
- `src/contexts/AuthContext.tsx` — load permission set on login; expose `hasPermission`, `isSuperadmin`, `roleName`.
- `src/components/layout/AppShell.tsx`, `src/app/(authenticated)/settings/page.tsx`, `src/app/(authenticated)/settings/employees/page.tsx` — capability-based gating.
- `src/app/(authenticated)/invoices/[id]/page.tsx`, `src/components/invoices/InvoiceForm.tsx` — capability-based gating.
- `src/components/employees/EmployeesManager.tsx` — role dropdown sourced from the `roles` table.

**Deleted**
- `src/lib/auth/require-admin.ts` (replaced by `require-permission.ts` in Task 5; deleted in Task 13 once no imports remain).

---

## Task 1: Database migration — tables, seed, backfill

**Files:** none in repo — applied via the `big-pos-supabase` MCP `apply_migration` tool.

- [ ] **Step 1: Apply the migration**

Call the MCP tool `mcp__big-pos-supabase__apply_migration` with name `configurable_roles_permissions` and this SQL. Fixed UUIDs are used for the three seed roles so backfill and permission inserts stay idempotent. The old `profiles.role` column is kept (but made nullable) and dropped later in Task 13 — so the app keeps working between tasks.

```sql
-- 1. Tables
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission text not null,
  primary key (role_id, permission)
);

-- 2. profiles.role_id (FK enables PostgREST embedding: profiles -> roles -> role_permissions)
alter table public.profiles add column if not exists role_id uuid references public.roles(id);
alter table public.profiles alter column role drop not null;

-- 3. Seed roles (names are placeholders the business will rename)
insert into public.roles (id, name, description, is_system) values
  ('00000000-0000-0000-0000-000000000001','Super Admin','Full system access. Manages roles and all settings.',true),
  ('00000000-0000-0000-0000-000000000002','Admin','All permissions. Template second tier.',false),
  ('00000000-0000-0000-0000-000000000003','Staff','Default front-line staff role.',false)
on conflict (id) do nothing;

-- 4. Permissions. Super Admin stores NONE (implicit-all in code).
-- Admin = all 18.
insert into public.role_permissions (role_id, permission)
select '00000000-0000-0000-0000-000000000002', p from (values
  ('createInvoice'),('editInvoice'),('deleteInvoice'),('voidInvoice'),('editFinalizedInvoice'),('applyDiscount'),
  ('createCustomer'),('editCustomer'),('deleteCustomer'),
  ('createProduct'),('editProduct'),('deleteProduct'),
  ('createService'),('editService'),('deleteService'),
  ('viewReports'),('manageEmployees'),('manageSettings')
) as t(p)
on conflict do nothing;

-- Staff = all EXCEPT manageEmployees, voidInvoice, editFinalizedInvoice, manageSettings
-- (reproduces today's staff capabilities so existing staff behave identically).
insert into public.role_permissions (role_id, permission)
select '00000000-0000-0000-0000-000000000003', p from (values
  ('createInvoice'),('editInvoice'),('deleteInvoice'),('applyDiscount'),
  ('createCustomer'),('editCustomer'),('deleteCustomer'),
  ('createProduct'),('editProduct'),('deleteProduct'),
  ('createService'),('editService'),('deleteService'),
  ('viewReports')
) as t(p)
on conflict do nothing;

-- 5. Backfill existing users. Current admins -> Super Admin (they are the owners and
-- must keep role management reachable). Current staff (and any null) -> Staff.
update public.profiles set role_id = '00000000-0000-0000-0000-000000000001' where role = 'admin' and role_id is null;
update public.profiles set role_id = '00000000-0000-0000-0000-000000000003' where (role = 'staff' or role is null) and role_id is null;

-- 6. Grants. RLS stays disabled (server actions are the boundary). Authenticated
-- users only need to READ roles/permissions (AuthContext, EmployeesManager,
-- RolesManager). All writes go through service-role server actions, so do NOT
-- grant insert/update/delete here.
grant select on public.roles to anon, authenticated;
grant select on public.role_permissions to anon, authenticated;
```

- [ ] **Step 2: Verify the data**

Call `mcp__big-pos-supabase__execute_sql` with:

```sql
select r.name, r.is_system, count(rp.permission) as perms,
       (select count(*) from public.profiles p where p.role_id = r.id) as users
from public.roles r
left join public.role_permissions rp on rp.role_id = r.id
group by r.id, r.name, r.is_system
order by r.name;
```

Expected: `Super Admin` (is_system=true, perms=0, users = your current admin count), `Admin` (perms=18, users=0), `Staff` (perms=14, users = your current staff count). Confirm every profile has a `role_id`:

```sql
select count(*) as orphans from public.profiles where role_id is null;
```

Expected: `orphans = 0`.

- [ ] **Step 3: Commit** (no repo files changed; record the migration in the plan history)

```bash
git commit --allow-empty -m "feat(db): add roles & role_permissions tables, seed + backfill"
```

---

## Task 2: Type definitions

**Files:**
- Modify: `src/lib/database.types.ts`

- [ ] **Step 1: Add role types and the `role_id` column**

In `src/lib/database.types.ts`, add after the `ServiceStatus` interface (around line 37) the new interfaces, and add `role_id` to `Profile`. Keep the existing `role` field for now (dropped in Task 13). Replace the `Profile` interface block:

```typescript
export interface Role {
  id: string
  name: string
  description: string | null
  is_system: boolean
  created_at: string
  updated_at: string
}

export interface RolePermission {
  role_id: string
  permission: string
}

export interface Profile {
  id: string
  username: string
  full_name: string
  role: ProfileRole | null
  role_id: string | null
  active: boolean
  created_at: string
  updated_at: string
  roles?: Role | null
}
```

- [ ] **Step 2: Register the new tables**

In the `Database['public']['Tables']` block (around line 137), add two rows next to `profiles`:

```typescript
      roles:                        { Row: Role;                       Insert: Omit<Role, 'id' | 'created_at' | 'updated_at'> & Partial<Pick<Role, 'id'>>; Update: Partial<Omit<Role, 'id' | 'created_at'>>; Relationships: [] }
      role_permissions:             { Row: RolePermission;             Insert: RolePermission;       Update: Partial<RolePermission>;       Relationships: [] }
```

- [ ] **Step 3: Allow `role_id` in `ProfileInsert`**

Replace the `ProfileInsert` type (around line 124) so inserts can supply `role_id` and omit the legacy `role`:

```typescript
type ProfileInsert = Omit<Profile, 'created_at' | 'updated_at' | 'full_name' | 'role' | 'active' | 'roles'> &
  Partial<Pick<Profile, 'full_name' | 'role' | 'active'>>
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: PASS (build completes; type errors elsewhere are addressed by later tasks — if the build fails only inside files this plan modifies later, that is expected. It must not fail inside `database.types.ts`.)

> Note: if `npm run build` surfaces errors in not-yet-migrated files, that's fine for this task — re-run after Task 12. To check just this file's types in isolation: `npx tsc --noEmit` and confirm no error originates in `database.types.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/database.types.ts
git commit -m "feat(types): add Role/RolePermission types and profiles.role_id"
```

---

## Task 3: Permission constants + pure helpers (TDD)

**Files:**
- Create: `src/lib/permissions.ts`
- Test: `src/lib/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/permissions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { permissionGranted, wouldRemoveLastSuperadmin, PERMISSIONS, PERMISSION_GROUPS } from './permissions'

describe('permissionGranted', () => {
  it('grants everything to a system (superadmin) role', () => {
    expect(permissionGranted({ is_system: true, permissions: [] }, 'voidInvoice')).toBe(true)
  })
  it('grants a permission the role holds', () => {
    expect(permissionGranted({ is_system: false, permissions: ['voidInvoice'] }, 'voidInvoice')).toBe(true)
  })
  it('denies a permission the role lacks', () => {
    expect(permissionGranted({ is_system: false, permissions: ['editInvoice'] }, 'voidInvoice')).toBe(false)
  })
})

describe('wouldRemoveLastSuperadmin', () => {
  it('blocks when the target is the only active superadmin and is losing it', () => {
    expect(wouldRemoveLastSuperadmin(['u1'], 'u1', false)).toBe(true)
  })
  it('allows when another active superadmin remains', () => {
    expect(wouldRemoveLastSuperadmin(['u1', 'u2'], 'u1', false)).toBe(false)
  })
  it('allows when the target keeps superadmin', () => {
    expect(wouldRemoveLastSuperadmin(['u1'], 'u1', true)).toBe(false)
  })
  it('allows when the target was not a superadmin', () => {
    expect(wouldRemoveLastSuperadmin(['u1'], 'u2', false)).toBe(false)
  })
})

describe('permission catalogue', () => {
  it('has 18 permissions across the groups', () => {
    const all = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key))
    expect(all.length).toBe(18)
    expect(new Set(all).size).toBe(18)
    expect(Object.values(PERMISSIONS).length).toBe(18)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/permissions.test.ts`
Expected: FAIL — `Cannot find module './permissions'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/permissions.ts`:

```typescript
// Fixed catalogue of capabilities shipped with the app. Users assign these to
// roles; they cannot invent new ones. Adding a flag later = add a constant here
// plus a row to PERMISSION_GROUPS, then wire the gate where it applies.
export const PERMISSIONS = {
  createInvoice: 'createInvoice',
  editInvoice: 'editInvoice',
  deleteInvoice: 'deleteInvoice',
  voidInvoice: 'voidInvoice',
  editFinalizedInvoice: 'editFinalizedInvoice',
  applyDiscount: 'applyDiscount',
  createCustomer: 'createCustomer',
  editCustomer: 'editCustomer',
  deleteCustomer: 'deleteCustomer',
  createProduct: 'createProduct',
  editProduct: 'editProduct',
  deleteProduct: 'deleteProduct',
  createService: 'createService',
  editService: 'editService',
  deleteService: 'deleteService',
  viewReports: 'viewReports',
  manageEmployees: 'manageEmployees',
  manageSettings: 'manageSettings',
} as const

export type Permission = keyof typeof PERMISSIONS

// Grouping is for display in the role editor only; underneath it is a flat list.
export const PERMISSION_GROUPS: { label: string; permissions: { key: Permission; label: string }[] }[] = [
  {
    label: 'Invoices',
    permissions: [
      { key: 'createInvoice', label: 'Create invoices' },
      { key: 'editInvoice', label: 'Edit draft invoices' },
      { key: 'deleteInvoice', label: 'Delete invoices' },
      { key: 'voidInvoice', label: 'Void & restore invoices' },
      { key: 'editFinalizedInvoice', label: 'Edit sent/paid invoices' },
      { key: 'applyDiscount', label: 'Apply discounts / override prices' },
    ],
  },
  {
    label: 'Customers',
    permissions: [
      { key: 'createCustomer', label: 'Create customers' },
      { key: 'editCustomer', label: 'Edit customers' },
      { key: 'deleteCustomer', label: 'Delete customers' },
    ],
  },
  {
    label: 'Products',
    permissions: [
      { key: 'createProduct', label: 'Create products' },
      { key: 'editProduct', label: 'Edit products' },
      { key: 'deleteProduct', label: 'Delete products' },
    ],
  },
  {
    label: 'Services',
    permissions: [
      { key: 'createService', label: 'Create service statuses' },
      { key: 'editService', label: 'Edit service statuses' },
      { key: 'deleteService', label: 'Delete service statuses' },
    ],
  },
  { label: 'Reports', permissions: [{ key: 'viewReports', label: 'View reports' }] },
  { label: 'Staff', permissions: [{ key: 'manageEmployees', label: 'Manage employees' }] },
  { label: 'Settings', permissions: [{ key: 'manageSettings', label: 'Manage settings' }] },
]

// Pure grant check. A system role (Super Admin) implicitly holds every permission.
export function permissionGranted(
  role: { is_system: boolean; permissions: string[] },
  permission: string,
): boolean {
  return role.is_system || role.permissions.includes(permission)
}

// Lockout guard: true when this change would leave zero active Super Admins.
// `targetStaysSuperadmin` is false when the user is being demoted OR deactivated.
export function wouldRemoveLastSuperadmin(
  activeSuperadminIds: string[],
  targetUserId: string,
  targetStaysSuperadmin: boolean,
): boolean {
  if (targetStaysSuperadmin) return false
  return activeSuperadminIds.length === 1 && activeSuperadminIds[0] === targetUserId
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/permissions.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/lib/permissions.test.ts
git commit -m "feat: permission catalogue and pure RBAC helpers"
```

---

## Task 4: Refactor `canEditInvoice` (TDD)

**Files:**
- Modify: `src/lib/invoice-permissions.ts`
- Test: `src/lib/invoice-permissions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/invoice-permissions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { canEditInvoice } from './invoice-permissions'

const inv = (status: string, voided_at: string | null = null) => ({ status, voided_at } as any)
const allow = () => true
const deny = () => false
const only = (...perms: string[]) => (p: string) => perms.includes(p)

describe('canEditInvoice', () => {
  it('locks a voided invoice for everyone', () => {
    expect(canEditInvoice(inv('draft', '2026-06-03T00:00:00Z'), allow)).toBe(false)
  })
  it('lets a holder of editInvoice edit a draft', () => {
    expect(canEditInvoice(inv('draft'), only('editInvoice'))).toBe(true)
  })
  it('blocks a draft edit without editInvoice', () => {
    expect(canEditInvoice(inv('draft'), deny)).toBe(false)
  })
  it('requires editFinalizedInvoice for a sent invoice', () => {
    expect(canEditInvoice(inv('sent'), only('editFinalizedInvoice'))).toBe(true)
    expect(canEditInvoice(inv('sent'), only('editInvoice'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/invoice-permissions.test.ts`
Expected: FAIL — `canEditInvoice` still expects a `role: string` argument; calls with a function will not behave as asserted (the `'sent'` + `only('editInvoice')` case returns the wrong result).

- [ ] **Step 3: Write the implementation**

Replace the body of `src/lib/invoice-permissions.ts`:

```typescript
import type { Invoice, Permission } from '@/lib/database.types'
import { isVoided } from '@/lib/invoice-status'

/**
 * Whether an invoice's content (header fields, line items, recipient,
 * patient/doctor) may be edited.
 *
 * Rules:
 * - Voided (soft-deleted) is terminal — locked for everyone.
 * - `draft` requires the `editInvoice` permission.
 * - Once sent (`sent`/`partial`/`paid`/`overdue`) requires `editFinalizedInvoice`.
 *
 * `has` is the caller's capability predicate (from AuthContext on the client).
 * UI gating only; the server action is the real boundary.
 */
export function canEditInvoice(
  inv: Pick<Invoice, 'status' | 'voided_at'>,
  has: (permission: Permission) => boolean,
): boolean {
  if (isVoided(inv)) return false
  return inv.status === 'draft' ? has('editInvoice') : has('editFinalizedInvoice')
}
```

> `Permission` is exported from `database.types` in Task 4a below. If `npm run build` complains it isn't found there, import it from `@/lib/permissions` instead — both are acceptable; pick whichever resolves.

- [ ] **Step 3a: Re-export `Permission` from database.types**

In `src/lib/database.types.ts`, add near the top (after line 3):

```typescript
export type { Permission } from '@/lib/permissions'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/invoice-permissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invoice-permissions.ts src/lib/invoice-permissions.test.ts src/lib/database.types.ts
git commit -m "refactor: canEditInvoice takes a permission predicate"
```

---

## Task 5: Server gates — `requirePermission` & `requireSuperadmin`

**Files:**
- Create: `src/lib/auth/require-permission.ts`

- [ ] **Step 1: Write the implementation**

Create `src/lib/auth/require-permission.ts`:

```typescript
import { createClient } from '@/lib/supabase/server'
import { permissionGranted } from '@/lib/permissions'

export type PermissionCheck =
  | { ok: true; userId: string }
  | { ok: false; error: string }

// Shape returned by the profiles->roles->role_permissions embed.
type ProfileWithRole = {
  active: boolean
  roles: { is_system: boolean; role_permissions: { permission: string }[] } | null
}

async function loadRole(): Promise<{ userId: string; profile: ProfileWithRole } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('active, roles(is_system, role_permissions(permission))')
    .eq('id', user.id)
    .single()

  if (!data) return null
  return { userId: user.id, profile: data as unknown as ProfileWithRole }
}

// Server-side gate. Reads role + permissions from the database (source of truth),
// so a freshly-changed role takes effect without re-login and a forged token
// can't grant access.
export async function requirePermission(permission: string): Promise<PermissionCheck> {
  const loaded = await loadRole()
  if (!loaded) return { ok: false, error: 'Not signed in' }
  const { userId, profile } = loaded
  if (!profile.active || !profile.roles) return { ok: false, error: 'Access denied' }

  const granted = permissionGranted(
    { is_system: profile.roles.is_system, permissions: profile.roles.role_permissions.map(p => p.permission) },
    permission,
  )
  if (!granted) return { ok: false, error: 'You do not have permission to do this.' }
  return { ok: true, userId }
}

// Gate for role management — Super Admin only.
export async function requireSuperadmin(): Promise<PermissionCheck> {
  const loaded = await loadRole()
  if (!loaded) return { ok: false, error: 'Not signed in' }
  const { userId, profile } = loaded
  if (!profile.active || !profile.roles?.is_system) {
    return { ok: false, error: 'Super Admin access required' }
  }
  return { ok: true, userId }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: the new file compiles. (`require-admin.ts` still exists and is still imported by other files — those are migrated in Tasks 6–9.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/require-permission.ts
git commit -m "feat(auth): requirePermission and requireSuperadmin server gates"
```

---

## Task 6: Role management server actions

**Files:**
- Create: `src/lib/auth/role-actions.ts`

- [ ] **Step 1: Write the implementation**

Create `src/lib/auth/role-actions.ts`:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSuperadmin } from '@/lib/auth/require-permission'
import { PERMISSIONS } from '@/lib/permissions'

export type ActionResult = { ok: true } | { ok: false; error: string }

const VALID = new Set<string>(Object.values(PERMISSIONS))

function cleanPermissions(input: string[]): string[] {
  return [...new Set(input.filter(p => VALID.has(p)))]
}

export async function createRole(input: {
  name: string
  description?: string
  permissions: string[]
}): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (!gate.ok) return gate

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Role name is required.' }

  const admin = createAdminClient()
  const { data: role, error } = await admin
    .from('roles')
    .insert({ name, description: input.description?.trim() || null, is_system: false })
    .select('id')
    .single()
  if (error || !role) return { ok: false, error: error?.message ?? 'Could not create role.' }

  const perms = cleanPermissions(input.permissions)
  if (perms.length) {
    const { error: permErr } = await admin
      .from('role_permissions')
      .insert(perms.map(permission => ({ role_id: role.id, permission })))
    if (permErr) return { ok: false, error: permErr.message }
  }

  revalidatePath('/settings/roles')
  return { ok: true }
}

export async function updateRole(input: {
  id: string
  name: string
  description?: string
  permissions: string[]
}): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (!gate.ok) return gate

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Role name is required.' }

  const admin = createAdminClient()

  // The built-in Super Admin role can't be edited (always all permissions).
  const { data: existing } = await admin.from('roles').select('is_system').eq('id', input.id).single()
  if (!existing) return { ok: false, error: 'Role not found.' }
  if (existing.is_system) return { ok: false, error: 'The Super Admin role cannot be edited.' }

  const { error: updErr } = await admin
    .from('roles')
    .update({ name, description: input.description?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', input.id)
  if (updErr) return { ok: false, error: updErr.message }

  // Replace the permission set wholesale.
  const { error: delErr } = await admin.from('role_permissions').delete().eq('role_id', input.id)
  if (delErr) return { ok: false, error: delErr.message }

  const perms = cleanPermissions(input.permissions)
  if (perms.length) {
    const { error: insErr } = await admin
      .from('role_permissions')
      .insert(perms.map(permission => ({ role_id: input.id, permission })))
    if (insErr) return { ok: false, error: insErr.message }
  }

  revalidatePath('/settings/roles')
  return { ok: true }
}

export async function deleteRole(input: { id: string }): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (!gate.ok) return gate

  const admin = createAdminClient()

  const { data: existing } = await admin.from('roles').select('is_system').eq('id', input.id).single()
  if (!existing) return { ok: false, error: 'Role not found.' }
  if (existing.is_system) return { ok: false, error: 'The Super Admin role cannot be deleted.' }

  // Block deletion while users still hold this role.
  const { count } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role_id', input.id)
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'Reassign the employees on this role before deleting it.' }
  }

  const { error } = await admin.from('roles').delete().eq('id', input.id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings/roles')
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/role-actions.ts
git commit -m "feat(auth): role create/update/delete server actions"
```

---

## Task 7: Migrate employee actions to roles + lockout guard

**Files:**
- Modify: `src/lib/auth/employee-actions.ts`

- [ ] **Step 1: Add a shared superadmin-id helper**

At the top of `src/lib/auth/employee-actions.ts`, replace the imports and the `ROLES`/`isRole` block (lines 1–18) with:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth/require-permission'
import { usernameToEmail, USERNAME_PATTERN } from '@/lib/auth/username'
import { wouldRemoveLastSuperadmin } from '@/lib/permissions'

export type ActionResult = { ok: true } | { ok: false; error: string }

const PIN_PATTERN = /^\d{6}$/
// Ban far into the future to disable sign-in + token refresh (~100 years).
const FOREVER_BAN = '876000h'

// IDs of every active user whose role is the built-in Super Admin.
async function activeSuperadminIds(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin
    .from('profiles')
    .select('id, roles!inner(is_system)')
    .eq('active', true)
    .eq('roles.is_system', true)
  return ((data ?? []) as { id: string }[]).map(r => r.id)
}

async function roleIsSuperadmin(admin: SupabaseClient, roleId: string): Promise<boolean> {
  const { data } = await admin.from('roles').select('is_system').eq('id', roleId).single()
  return !!data?.is_system
}
```

- [ ] **Step 2: Update `createEmployee` to take `roleId`**

Replace the `createEmployee` function (originally lines 20–69) with:

```typescript
export async function createEmployee(input: {
  username: string
  pin: string
  fullName: string
  roleId: string
}): Promise<ActionResult> {
  const gate = await requirePermission('manageEmployees')
  if (!gate.ok) return gate

  const username = input.username.trim()
  const fullName = input.fullName.trim() || username
  const { pin, roleId } = input

  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: 'User ID must be 3–30 letters, numbers, dot, dash or underscore.' }
  }
  if (!PIN_PATTERN.test(pin)) return { ok: false, error: 'PIN must be exactly 6 digits.' }
  if (!roleId) return { ok: false, error: 'Please choose a role.' }

  const admin = createAdminClient()

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password: pin,
    email_confirm: true,
    user_metadata: { username, full_name: fullName },
  })
  if (createErr || !created.user) {
    const dup = createErr?.message?.toLowerCase().includes('already')
    return { ok: false, error: dup ? 'That User ID is already taken.' : (createErr?.message ?? 'Could not create employee.') }
  }

  const { error: profileErr } = await admin.from('profiles').insert({
    id: created.user.id,
    username,
    full_name: fullName,
    role_id: roleId,
    active: true,
  })
  if (profileErr) {
    await admin.auth.admin.deleteUser(created.user.id)
    const dup = profileErr.message.toLowerCase().includes('duplicate') || profileErr.code === '23505'
    return { ok: false, error: dup ? 'That User ID is already taken.' : 'Could not save employee profile.' }
  }

  revalidatePath('/settings/employees')
  return { ok: true }
}
```

- [ ] **Step 3: Keep `resetPin` but swap its gate**

In `resetPin`, change the first two lines of the body from `const gate = await requireAdmin()` to:

```typescript
  const gate = await requirePermission('manageEmployees')
```

- [ ] **Step 4: Update `updateEmployee` to take `roleId` + last-superadmin guard**

Replace the `updateEmployee` function with:

```typescript
export async function updateEmployee(input: {
  id: string
  fullName: string
  roleId: string
}): Promise<ActionResult> {
  const gate = await requirePermission('manageEmployees')
  if (!gate.ok) return gate

  const fullName = input.fullName.trim()
  const { id, roleId } = input
  if (!fullName) return { ok: false, error: 'Name is required.' }
  if (!roleId) return { ok: false, error: 'Please choose a role.' }

  const admin = createAdminClient()

  // Lockout guard: don't let the last active Super Admin be moved off the role.
  const becomingSuperadmin = await roleIsSuperadmin(admin, roleId)
  const supers = await activeSuperadminIds(admin)
  if (wouldRemoveLastSuperadmin(supers, id, becomingSuperadmin)) {
    return { ok: false, error: 'You cannot remove the last Super Admin. Assign another first.' }
  }

  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    user_metadata: { full_name: fullName },
  })
  if (authErr) return { ok: false, error: authErr.message }

  const { error: profileErr } = await admin
    .from('profiles')
    .update({ full_name: fullName, role_id: roleId })
    .eq('id', id)
  if (profileErr) return { ok: false, error: profileErr.message }

  revalidatePath('/settings/employees')
  return { ok: true }
}
```

- [ ] **Step 5: Update `setActive` gate + last-superadmin guard**

Replace the `setActive` function with:

```typescript
export async function setActive(input: { id: string; active: boolean }): Promise<ActionResult> {
  const gate = await requirePermission('manageEmployees')
  if (!gate.ok) return gate

  // Don't let an admin deactivate themselves.
  if (input.id === gate.userId && !input.active) {
    return { ok: false, error: 'You cannot deactivate your own account.' }
  }

  const admin = createAdminClient()

  // Lockout guard: deactivating the last active Super Admin would lock out role management.
  if (!input.active) {
    const supers = await activeSuperadminIds(admin)
    if (wouldRemoveLastSuperadmin(supers, input.id, false)) {
      return { ok: false, error: 'You cannot deactivate the last Super Admin.' }
    }
  }

  const { error: authErr } = await admin.auth.admin.updateUserById(input.id, {
    ban_duration: input.active ? 'none' : FOREVER_BAN,
  })
  if (authErr) return { ok: false, error: authErr.message }

  const { error: profileErr } = await admin
    .from('profiles')
    .update({ active: input.active })
    .eq('id', input.id)
  if (profileErr) return { ok: false, error: profileErr.message }

  revalidatePath('/settings/employees')
  return { ok: true }
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: `employee-actions.ts` compiles. (`EmployeesManager.tsx` still passes `role` — fixed in Task 11. If build fails only there, continue.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/employee-actions.ts
git commit -m "refactor(auth): employee actions use role_id + manageEmployees gate + lockout guard"
```

---

## Task 8: Void actions gate

**Files:**
- Modify: `src/lib/invoices/void-actions.ts`

- [ ] **Step 1: Swap the gate**

In `src/lib/invoices/void-actions.ts`, change the import on line 5 from:

```typescript
import { requireAdmin } from '@/lib/auth/require-admin'
```
to:
```typescript
import { requirePermission } from '@/lib/auth/require-permission'
```

Then in BOTH `voidInvoice` and `restoreInvoice`, replace `const gate = await requireAdmin()` with:

```typescript
  const gate = await requirePermission('voidInvoice')
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: `void-actions.ts` compiles.

- [ ] **Step 3: Commit**

```bash
git add src/lib/invoices/void-actions.ts
git commit -m "refactor(invoices): void/restore gated by voidInvoice permission"
```

---

## Task 9: AuthContext — load permissions, expose `hasPermission`

**Files:**
- Modify: `src/contexts/AuthContext.tsx`

- [ ] **Step 1: Replace the file**

Replace the whole of `src/contexts/AuthContext.tsx` with:

```typescript
'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Permission } from '@/lib/permissions'

interface AuthContextType {
  session: Session | null
  user: Session['user'] | null
  username: string
  roleName: string
  isSuperadmin: boolean
  hasPermission: (permission: Permission) => boolean
  loading: boolean
  signOut: () => Promise<void>
}

const noPerms = () => false

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  username: '',
  roleName: '',
  isSuperadmin: false,
  hasPermission: noPerms,
  loading: true,
  signOut: async () => {},
})

type RoleInfo = { name: string; isSuperadmin: boolean; permissions: Set<string> }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<RoleInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const loadRole = async (userId: string): Promise<RoleInfo | null> => {
      const { data } = await supabase
        .from('profiles')
        .select('roles(name, is_system, role_permissions(permission))')
        .eq('id', userId)
        .single()
      const r = (data as { roles?: { name: string; is_system: boolean; role_permissions: { permission: string }[] } | null } | null)?.roles
      if (!r) return null
      return { name: r.name, isSuperadmin: r.is_system, permissions: new Set(r.role_permissions.map(p => p.permission)) }
    }

    const apply = async (s: Session | null) => {
      setSession(s)
      if (s?.user) {
        const info = await loadRole(s.user.id)
        if (active) setRole(info)
      } else if (active) {
        setRole(null)
      }
      if (active) setLoading(false)
    }

    supabase.auth.getSession().then(({ data: { session } }) => apply(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { apply(session) })

    return () => { active = false; subscription.unsubscribe() }
  }, [])

  const signOut = async () => { await supabase.auth.signOut() }

  const username: string = session?.user?.user_metadata?.username ?? ''
  const isSuperadmin = role?.isSuperadmin ?? false
  const hasPermission = (permission: Permission) => isSuperadmin || (role?.permissions.has(permission) ?? false)

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      username,
      roleName: role?.name ?? '',
      isSuperadmin,
      hasPermission,
      loading,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: `AuthContext.tsx` compiles. Consumers still referencing `role`/`isAdmin` (AppShell, settings page, invoice pages, InvoiceForm) will fail — fixed in Tasks 10–11. Continue past those.

- [ ] **Step 3: Commit**

```bash
git add src/contexts/AuthContext.tsx
git commit -m "feat(auth): AuthContext loads permission set, exposes hasPermission/isSuperadmin"
```

---

## Task 10: Gate nav, settings, employees page, and invoice UI

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/app/(authenticated)/settings/page.tsx`
- Modify: `src/app/(authenticated)/settings/employees/page.tsx`
- Modify: `src/app/(authenticated)/invoices/[id]/page.tsx`
- Modify: `src/components/invoices/InvoiceForm.tsx`

- [ ] **Step 1: AppShell — nav by permission**

In `src/components/layout/AppShell.tsx`:

Change the `adminNavItems` declaration (line 26-28) to tag the required permission:

```typescript
const permissionNavItems = [
  { href: '/settings/employees', icon: UserCog, label: 'Employees', permission: 'manageEmployees' as const },
]
```

Change the hook destructure (line 31) from `const { username, role, isAdmin, signOut } = useAuth()` to:

```typescript
  const { username, roleName, hasPermission, signOut } = useAuth()
```

Change the items computation (line 36) to:

```typescript
  const items = [...navItems, ...permissionNavItems.filter(i => hasPermission(i.permission))]
```

Change the sidebar role label (line 94) from `{role}` to:

```typescript
          <p className="text-xs text-gray-400 capitalize">{roleName}</p>
```

- [ ] **Step 2: Settings page — gate Employees + add Roles (Super Admin)**

Replace the body of `src/app/(authenticated)/settings/page.tsx` with:

```typescript
'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronRight, ClipboardList, UserCog, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

const sections = [
  {
    href: '/settings/service-statuses',
    icon: ClipboardList,
    title: 'Service Statuses',
    description: 'Delivery-note instructions to the doctor (Try in, Redo, Final…).',
  },
]

export default function SettingsPage() {
  const { hasPermission, isSuperadmin } = useAuth()

  const visibleSections = [
    ...sections,
    ...(hasPermission('manageEmployees')
      ? [{ href: '/settings/employees', icon: UserCog, title: 'Employees', description: 'Add staff logins, reset PINs, assign roles, and manage access.' }]
      : []),
    ...(isSuperadmin
      ? [{ href: '/settings/roles', icon: ShieldCheck, title: 'Roles & Permissions', description: 'Create roles and choose what each one can do.' }]
      : []),
  ]

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configure lookups and defaults used across the app.</p>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {visibleSections.map(({ href, icon: Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{description}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Employees page — gate on manageEmployees**

Replace `src/app/(authenticated)/settings/employees/page.tsx` with:

```typescript
import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/auth/require-permission'
import EmployeesManager from '@/components/employees/EmployeesManager'

// manageEmployees only. Enforced server-side so non-holders can't reach the page
// even if the nav item were exposed.
export default async function EmployeesPage() {
  const gate = await requirePermission('manageEmployees')
  if (!gate.ok) redirect('/dashboard')

  return <EmployeesManager currentUserId={gate.userId} />
}
```

- [ ] **Step 4: Invoice detail page — void/edit by permission**

In `src/app/(authenticated)/invoices/[id]/page.tsx`:

Change the hook destructure (line 74) from `const { user, role, isAdmin } = useAuth()` to:

```typescript
  const { user, hasPermission } = useAuth()
```

Change the `canEdit` computation (line 581) to:

```typescript
  const canEdit = canEditInvoice(invoice, hasPermission)
```

Change the Locked hint text (line 601) to:

```typescript
                  title="This invoice has been sent. You don't have permission to edit it."
```

Change the two `isAdmin` void/restore guards (lines 639 and 649) to `hasPermission('voidInvoice')`:

```typescript
          {hasPermission('voidInvoice') && !voided && (
```
and
```typescript
          {hasPermission('voidInvoice') && voided && (
```

- [ ] **Step 5: InvoiceForm — edit lock by permission**

In `src/components/invoices/InvoiceForm.tsx`:

Change the hook destructure (line 34) from `const { user, role, loading: authLoading } = useAuth()` to:

```typescript
  const { user, hasPermission, loading: authLoading } = useAuth()
```

Change the edit-lock effect (line 135) to:

```typescript
    if (!canEditInvoice({ status: loadedStatus, voided_at: loadedVoidedAt }, hasPermission)) {
```

Update that effect's dependency array (line 138) — replace `role` with `hasPermission`:

```typescript
  }, [isEdit, authLoading, loadedStatus, loadedVoidedAt, hasPermission, invoiceId, router])
```

Change the `blocked` computation (line 328) to:

```typescript
  const blocked = isEdit && loadedStatus !== null && !authLoading && !canEditInvoice({ status: loadedStatus, voided_at: loadedVoidedAt }, hasPermission)
```

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: these files compile. (`EmployeesManager.tsx` still uses old role props — Task 11.)

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/AppShell.tsx "src/app/(authenticated)/settings/page.tsx" "src/app/(authenticated)/settings/employees/page.tsx" "src/app/(authenticated)/invoices/[id]/page.tsx" src/components/invoices/InvoiceForm.tsx
git commit -m "feat: gate nav, settings, employees, and invoice UI by permissions"
```

---

## Task 11: EmployeesManager — assign roles from the roles table

**Files:**
- Modify: `src/components/employees/EmployeesManager.tsx`

- [ ] **Step 1: Update imports + types**

Change the type import (line 16) from:
```typescript
import type { Profile, ProfileRole } from '@/lib/database.types'
```
to:
```typescript
import type { Profile, Role } from '@/lib/database.types'
```

- [ ] **Step 2: Load roles and embed role on profiles**

In the `EmployeesManager` component, change the `load` function (lines 32-40) to embed the role, and add a roles list:

```typescript
  const [roles, setRoles] = useState<Role[]>([])

  const load = () =>
    supabase
      .from('profiles')
      .select('*, roles(id, name, is_system)')
      .order('full_name')
      .then(({ data }) => {
        setRows((data as Profile[]) ?? [])
        setLoading(false)
      })

  useEffect(() => {
    load()
    supabase.from('roles').select('*').order('name').then(({ data }) => setRoles((data as Role[]) ?? []))
  }, [])
```

(Remove the old standalone `useEffect(() => { load() }, [])` on line 42.)

- [ ] **Step 3: Show the role name badge**

Replace the role badge cell (lines 98-105) with:

```typescript
                  <TableCell>
                    <span className={cn(
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      p.roles?.is_system ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-600',
                    )}>
                      {p.roles?.name ?? '—'}
                    </span>
                  </TableCell>
```

- [ ] **Step 4: Pass roles into the dialog**

Where `<EmployeeDialog ... />` is rendered (around line 144), add a `roles` prop:

```typescript
        <EmployeeDialog
          key={dialog.mode === 'create' ? 'create' : `${dialog.mode}:${dialog.employee.id}`}
          state={dialog}
          roles={roles}
          onClose={() => setDialog({ mode: 'closed' })}
          onSaved={async () => { setDialog({ mode: 'closed' }); await load() }}
        />
```

- [ ] **Step 5: Update the dialog to use roleId**

Change the `EmployeeDialog` signature and role state. Replace the props type and the `role` state line (around lines 175-188):

```typescript
function EmployeeDialog({
  state,
  roles,
  onClose,
  onSaved,
}: {
  state: Exclude<DialogState, { mode: 'closed' }>
  roles: Role[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const employee = 'employee' in state ? state.employee : null
  const [username, setUsername] = useState(employee?.username ?? '')
  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [pin, setPin] = useState('')
  const [roleId, setRoleId] = useState<string>(employee?.role_id ?? roles[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
```

- [ ] **Step 6: Update submit calls**

Replace the submit branch calls (around lines 200-207):

```typescript
    let res
    if (state.mode === 'create') {
      res = await createEmployee({ username, pin, fullName, roleId })
    } else if (state.mode === 'edit') {
      res = await updateEmployee({ id: state.employee.id, fullName, roleId })
    } else {
      res = await resetPin({ id: state.employee.id, pin })
    }
```

- [ ] **Step 7: Replace the role Select options**

Replace the role Select block (lines 258-268) with a list sourced from `roles`:

```typescript
              <div className="space-y-2">
                <Label>Role *</Label>
                <Select value={roleId} onValueChange={setRoleId}>
                  <SelectTrigger><SelectValue placeholder="Choose a role" /></SelectTrigger>
                  <SelectContent>
                    {roles.map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400">Each role grants a set of permissions. Manage roles in Settings → Roles.</p>
              </div>
```

- [ ] **Step 8: Typecheck**

Run: `npm run build`
Expected: PASS for this file.

- [ ] **Step 9: Commit**

```bash
git add src/components/employees/EmployeesManager.tsx
git commit -m "feat(employees): assign roles from the roles table"
```

---

## Task 12: Roles management page + editor

**Files:**
- Create: `src/app/(authenticated)/settings/roles/page.tsx`
- Create: `src/components/roles/RolesManager.tsx`

- [ ] **Step 1: Create the page (Super Admin gated server-side)**

Create `src/app/(authenticated)/settings/roles/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { requireSuperadmin } from '@/lib/auth/require-permission'
import RolesManager from '@/components/roles/RolesManager'

// Super Admin only — the role that owns role management.
export default async function RolesPage() {
  const gate = await requireSuperadmin()
  if (!gate.ok) redirect('/dashboard')

  return <RolesManager />
}
```

- [ ] **Step 2: Create the manager component**

Create `src/components/roles/RolesManager.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { ArrowLeft, Plus, Pencil, Trash2, ShieldCheck } from 'lucide-react'
import { PERMISSION_GROUPS, type Permission } from '@/lib/permissions'
import { createRole, updateRole, deleteRole } from '@/lib/auth/role-actions'
import type { Role } from '@/lib/database.types'

type RoleRow = Role & { perms: Set<string>; userCount: number }
type DialogState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; role: RoleRow }

export default function RolesManager() {
  const [rows, setRows] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' })

  const load = async () => {
    const { data: roles } = await supabase
      .from('roles')
      .select('*, role_permissions(permission)')
      .order('is_system', { ascending: false })
      .order('name')
    const { data: profiles } = await supabase.from('profiles').select('role_id')
    const counts = new Map<string, number>()
    for (const p of profiles ?? []) {
      if (p.role_id) counts.set(p.role_id, (counts.get(p.role_id) ?? 0) + 1)
    }
    const mapped: RoleRow[] = ((roles as (Role & { role_permissions: { permission: string }[] })[]) ?? []).map(r => ({
      ...r,
      perms: new Set(r.role_permissions.map(rp => rp.permission)),
      userCount: counts.get(r.id) ?? 0,
    }))
    setRows(mapped)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const remove = async (role: RoleRow) => {
    if (!confirm(`Delete the “${role.name}” role?`)) return
    const res = await deleteRole({ id: role.id })
    if (!res.ok) { alert(res.error); return }
    await load()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Roles &amp; Permissions</h1>
            <p className="text-sm text-gray-500 mt-0.5">Create roles and choose what each one can do.</p>
          </div>
        </div>
        <Button onClick={() => setDialog({ mode: 'create' })}><Plus className="h-4 w-4 mr-2" />New role</Button>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {loading && <p className="text-center py-8 text-gray-400">Loading…</p>}
          {!loading && rows.map(role => (
            <div key={role.id} className="flex items-center gap-4 px-5 py-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{role.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {role.is_system ? 'All permissions' : `${role.perms.size} permission${role.perms.size === 1 ? '' : 's'}`}
                  {' · '}{role.userCount} {role.userCount === 1 ? 'person' : 'people'}
                </p>
              </div>
              {!role.is_system && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDialog({ mode: 'edit', role })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={role.userCount > 0} onClick={() => remove(role)}>
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {dialog.mode !== 'closed' && (
        <RoleDialog
          key={dialog.mode === 'create' ? 'create' : dialog.role.id}
          state={dialog}
          onClose={() => setDialog({ mode: 'closed' })}
          onSaved={async () => { setDialog({ mode: 'closed' }); await load() }}
        />
      )}
    </div>
  )
}

function RoleDialog({
  state,
  onClose,
  onSaved,
}: {
  state: Exclude<DialogState, { mode: 'closed' }>
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const role = state.mode === 'edit' ? state.role : null
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.perms ?? []))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (key: Permission) => {
    setPerms(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const permissions = [...perms]
    const res = state.mode === 'create'
      ? await createRole({ name, description, permissions })
      : await updateRole({ id: state.role.id, name, description, permissions })
    setSaving(false)
    if (res.ok) await onSaved()
    else setError(res.error)
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{state.mode === 'create' ? 'New role' : 'Edit role'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Role name *</Label>
            <Input placeholder="e.g. Operations" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input placeholder="Optional" value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          <div className="space-y-4">
            {PERMISSION_GROUPS.map(group => (
              <div key={group.label}>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{group.label}</p>
                <div className="space-y-2">
                  {group.permissions.map(p => (
                    <label key={p.key} className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer">
                      <Checkbox checked={perms.has(p.key)} onCheckedChange={() => toggle(p.key)} />
                      {p.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save role'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Ensure the Checkbox UI primitive exists**

Run: `ls src/components/ui/checkbox.tsx`

If it does NOT exist, create it (shadcn pattern; `@radix-ui/react-checkbox` is needed). First check the dep: `node -e "require('@radix-ui/react-checkbox')"` — if it errors, run `npm install @radix-ui/react-checkbox`. Then create `src/components/ui/checkbox.tsx`:

```typescript
'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn('flex items-center justify-center text-current')}>
      <Check className="h-3.5 w-3.5" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: PASS — the whole app now compiles.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authenticated)/settings/roles/page.tsx" src/components/roles/RolesManager.tsx src/components/ui/checkbox.tsx package.json package-lock.json
git commit -m "feat(roles): Super Admin role management page with permission checklist"
```

---

## Task 13: Cleanup — drop legacy `role`, delete `require-admin.ts`, full verification

**Files:**
- Delete: `src/lib/auth/require-admin.ts`
- Modify: `src/lib/database.types.ts`
- DB: drop `profiles.role` via MCP

- [ ] **Step 1: Confirm nothing imports the old gate or `ProfileRole`**

Run: `grep -rn "require-admin\|requireAdmin\|ProfileRole" src`
Expected: no results. If any remain, fix them before continuing (they should all have been migrated in Tasks 5–11).

- [ ] **Step 2: Delete the old gate**

Run: `git rm src/lib/auth/require-admin.ts`

- [ ] **Step 3: Remove the legacy type members**

In `src/lib/database.types.ts`: delete the `export type ProfileRole = 'admin' | 'staff'` line (line 3), and remove the `role: ProfileRole | null` field from the `Profile` interface. Update `ProfileInsert` to no longer reference `role`:

```typescript
type ProfileInsert = Omit<Profile, 'created_at' | 'updated_at' | 'full_name' | 'active' | 'roles'> &
  Partial<Pick<Profile, 'full_name' | 'active'>>
```

- [ ] **Step 4: Drop the DB column**

Call `mcp__big-pos-supabase__apply_migration`, name `drop_legacy_profiles_role`, SQL:

```sql
alter table public.profiles drop column if exists role;
```

- [ ] **Step 5: Full verification**

Run each and confirm:
- `npm test` → all suites PASS (permissions, invoice-permissions, invoice-status).
- `npm run build` → PASS, no type errors.
- `npm run lint` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/database.types.ts src/lib/auth/require-admin.ts
git commit -m "chore: drop legacy profiles.role column and require-admin gate"
```

---

## Manual verification checklist (run the app)

Start the app (`npm run dev`) and verify end-to-end:

- [ ] Sign in as a migrated **admin** → sidebar role label reads "Super Admin"; Settings shows **Employees** and **Roles & Permissions**.
- [ ] Settings → Roles: create a role "Operations" with a subset of permissions; it appears with the right permission count.
- [ ] Edit "Operations", change permissions, save; reopen and confirm they persisted.
- [ ] Try to delete a role that has users → blocked with the reassign message. Delete an empty role → succeeds.
- [ ] Confirm the **Super Admin** row has no edit/delete buttons.
- [ ] Employees: edit an employee, assign them the "Operations" role.
- [ ] Sign in as a migrated **staff** user → no Employees/Roles in nav; can still create/edit draft invoices; cannot see Void button; opening a sent invoice shows "Locked".
- [ ] As staff, hitting `/settings/employees` or `/settings/roles` directly → redirected to dashboard.
- [ ] Lockout guard: with one Super Admin, try to change their role to non-superadmin or deactivate them → blocked.

---

## Phase 2 (follow-up, NOT in this plan): wire the remaining flags

These permissions are defined, seeded, and assignable but **not yet enforced** — wire each to its buttons later, one module at a time:

- `createCustomer` / `editCustomer` / `deleteCustomer` → customers list + detail pages.
- `createProduct` / `editProduct` / `deleteProduct` → products page.
- `createService` / `editService` / `deleteService` → `settings/service-statuses`.
- `viewReports` → gate the Reports nav item + `/reports` page.
- `manageSettings` → gate `settings/service-statuses`.
- `deleteInvoice` / `applyDiscount` → invoice delete button + discount inputs in `InvoiceForm`.

Each follows the same pattern: `hasPermission('x')` to show/hide the control, and `requirePermission('x')` in the matching server action.
