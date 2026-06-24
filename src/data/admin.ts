// Read queries for the Super Admin Console. These use the service-role admin
// client because the console surfaces rows the normal UI hides (soft-deleted
// invoices, archived clinics, the audit log). The page gates on
// requireSuperadmin() before calling any of these.

import { createAdminClient } from '@/lib/supabase/admin'

export interface DeletedInvoiceRow {
  id: string
  invoice_number: string
  total: number
  deleted_at: string
  delete_reason: string | null
  customers: { clinic_name: string } | null
}

export interface ArchivedClinicRow {
  id: string
  clinic_name: string
  archived_at: string
}

export interface AuditRow {
  id: string
  actor_id: string
  action: string
  entity_type: string
  entity_label: string | null
  reason: string | null
  created_at: string
}

export async function getDeletedInvoices(): Promise<DeletedInvoiceRow[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('invoices')
    .select('id, invoice_number, total, deleted_at, delete_reason, customers(clinic_name)')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  return (data ?? []) as unknown as DeletedInvoiceRow[]
}

export async function getArchivedClinics(): Promise<ArchivedClinicRow[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('customers')
    .select('id, clinic_name, archived_at')
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
  return (data ?? []) as unknown as ArchivedClinicRow[]
}

export async function getAuditFeed(limit = 100): Promise<AuditRow[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('admin_audit_log')
    .select('id, actor_id, action, entity_type, entity_label, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as AuditRow[]
}

export async function getClinicDependencyCounts(id: string): Promise<{ invoices: number; credits: number }> {
  const admin = createAdminClient()
  const [{ count: invoices }, { count: credits }] = await Promise.all([
    admin.from('invoices').select('id', { count: 'exact', head: true }).eq('customer_id', id),
    admin.from('credits').select('id', { count: 'exact', head: true }).eq('customer_id', id),
  ])
  return { invoices: invoices ?? 0, credits: credits ?? 0 }
}
