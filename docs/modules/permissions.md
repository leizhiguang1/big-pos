# Permissions

**Source:** [`src/domain/permissions.ts`](../../src/domain/permissions.ts)

---

## Overview

The permission system is a **fixed catalogue** of 12 capability keys. Users cannot invent new keys — the set is compiled into the application. Roles collect subsets of these keys; at runtime, `permissionGranted` answers whether a role carries a given key.

---

## The 12 permission keys

| Key | Description |
|---|---|
| `invoices.view` | Open the Invoices section at all |
| `invoices.edit` | Create and edit **draft** invoices |
| `invoices.manage` | Void and edit **already-sent** invoices |
| `customers.view` | Open the Customers section |
| `customers.edit` | Add and edit customers |
| `products.view` | Open the Products section |
| `products.edit` | Add and edit products |
| `services.view` | View service statuses |
| `services.edit` | Add and edit service statuses |
| `reports.view` | View the Reports section (read-only; there is no `reports.edit`) |
| `staff.manage` | Manage employees (create, update, activate/deactivate, reset PIN) |
| `settings.manage` | Manage application settings (work stages, roles) |

### Module pattern

Most data modules follow: `<module>.view` (read access) + `<module>.edit` (write access). Invoices adds a third tier, `invoices.manage`, for power actions that could affect already-sent billing records. Reports is view-only — there is no `reports.edit`. Staff and Settings are single manage toggles.

### Display groupings

For the role-editor UI, the keys are grouped in `PERMISSION_GROUPS`:

- **Invoices** — view, edit, manage
- **Customers** — view, edit
- **Products** — view, edit
- **Services** — view, edit
- **Administration** — reports.view, staff.manage, settings.manage

These groupings are display-only; the underlying grant table (`role_permissions`) is a flat `(role_id, permission)` list.

---

## `is_system` — Super Admin semantics

`roles.is_system = true` designates the **Super Admin** role. A Super Admin implicitly holds every permission — `permissionGranted` short-circuits before checking the `permissions` array:

```ts
export function permissionGranted(
  role: { is_system: boolean; permissions: string[] },
  permission: string,
): boolean {
  return role.is_system || role.permissions.includes(permission)
}
```

The system role is **read-only in the UI** — its permissions cannot be edited, and it cannot be deleted. The lockout guard `wouldRemoveLastSuperadmin` prevents demoting or deactivating the last active Super Admin.

---

## Where permission checks happen

### Client-side (UI gating only)

`AuthContext` (`src/contexts/AuthContext.tsx`) loads the user's role and flattens permissions into a `Set` on session change. `hasPermission(p)` (from the context) controls whether UI buttons and form guards are rendered.

This is **UI-only** — the Supabase RLS policy for business tables is permissive (`authenticated_all`), so any logged-in user can write directly to the API. The current design is accepted for the small trusted-staff deployment.

### Server-side (real enforcement)

The following actions are gated server-side via `requirePermission` / `requireSuperadmin` in `src/lib/auth/require-permission.ts`, which reads the role **from the DB** (not from the session token):

| Action | Guard |
|---|---|
| Invoice void | `requirePermission('invoices.manage')` |
| Employee create / update / delete / reset PIN | `requirePermission('staff.manage')` |
| Role create / update / delete | `requireSuperadmin()` |

### Deferred enforcement (Spec 5 / Plan 2)

Extending server-side enforcement to the remaining business data (invoices, items, payments, customers, products, work) is tracked in Plan 2. The seam is **server actions** — moving Supabase writes from the browser client into `'use server'` functions where `requirePermission` can be called before any DB write.

---

## How to change this

### Add a new permission key (e.g. `reports.export`)
1. Add the key to the `PERMISSIONS` object in `src/domain/permissions.ts`.
2. Add a display entry to `PERMISSION_GROUPS` under the relevant group.
3. No DB migration is needed — `role_permissions.permission` is plain text.
4. Add `requirePermission('reports.export')` to any server action that should be gated.
5. Add `hasPermission('reports.export')` guards in the UI where needed.

### Remove a permission key
Removing a key is safe at the app level (no rows referencing it will break queries), but existing `role_permissions` rows with the old key become orphans. Clean up with:
```sql
DELETE FROM role_permissions WHERE permission = 'old.key';
```

### Promote a role to Super Admin
Set `roles.is_system = true` via a service-role server action or a direct DB update. Ensure the lockout guard cannot leave zero active Super Admins.
