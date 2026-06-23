// Convenience layer over the schema-driven types in `database-generated.types.ts`.
//
// `database-generated.types.ts` is produced verbatim by the Supabase CLI:
//   supabase gen types typescript --project-id xjwkmlmkwpbxjziyngmb > src/lib/database-generated.types.ts
// Regenerate it (never hand-edit) whenever the database schema changes.
//
// This file re-exports the generated `Database` type — which `@supabase/supabase-js`
// requires to satisfy its GenericSchema constraint — and derives the named row
// aliases the app imports (`Customer`, `Invoice`, …) from it, so the app types
// stay in lockstep with the real schema instead of being hand-maintained.

import type { Database, Tables } from './database-generated.types'

export type { Database, Json, Tables, TablesInsert, TablesUpdate } from './database-generated.types'
export type { Permission } from '@/domain/permissions'

// --- Domain status types ---------------------------------------------------

// `work_status` is a real Postgres enum, so derive the union from the schema.
export type WorkStatus = Database['public']['Enums']['work_status']

// `invoices.status` is a plain text column (no DB enum), so the schema types it
// as `string` and `Invoice.status` keeps that. This union is the app's domain
// vocabulary for those values — use it where a value is known to be one of them
// (e.g. form state). See `invoice-status.ts` for the state machine.
export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue'

// `credits.reason` is a plain text column (no DB enum), typed as `string` by the
// schema. This union is the app's domain vocabulary for a credit's reason —
// remake / return / goodwill (all non-chargeable adjustments). See `credits.ts`.
export type CreditReason = 'remake' | 'return' | 'goodwill'

// --- Table row aliases (schema-driven) -------------------------------------

export type Customer = Tables<'customers'>
export type Product = Tables<'products'>
export type ServiceStatus = Tables<'service_statuses'>
export type WorkStage = Tables<'work_stages'>
export type Unit = Tables<'units'>
export type Role = Tables<'roles'>
export type RolePermission = Tables<'role_permissions'>
export type Payment = Tables<'payments'>
export type Credit = Tables<'credits'>
export type InvoiceItem = Tables<'invoice_items'>
export type InvoiceItemStatusHistory = Tables<'invoice_item_status_history'>

// Invoice carries the nested relations that
// `select('*, customers(*), invoice_items(*), payments(*))` queries return.
export type Invoice = Tables<'invoices'> & {
  customers?: Customer
  invoice_items?: InvoiceItem[]
  payments?: Payment[]
  service_statuses?: ServiceStatus | null
}

// Profile carries the joined `roles` relation used across auth/permission code.
export type Profile = Tables<'profiles'> & {
  roles?: Role | null
}
