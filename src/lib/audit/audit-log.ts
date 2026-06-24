import { createAdminClient } from '@/lib/supabase/admin'
import { logServerError } from '@/lib/log'

export type AuditAction =
  | 'invoice.soft_delete' | 'invoice.restore' | 'invoice.purge' | 'invoice.void_restore'
  | 'customer.purge'
  | 'payment.delete' | 'credit.delete'
  | 'product.delete' | 'employee.delete'

export interface AuditEntry {
  actorId: string
  action: AuditAction
  entityType: string
  entityId?: string | null
  entityLabel?: string | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
}

// Best-effort audit write. Never throws — a failed audit insert must not abort the
// admin action it accompanies; it is logged instead so the operation still
// succeeds and the failure is visible in server logs.
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('admin_audit_log').insert({
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      entity_label: entry.entityLabel ?? null,
      reason: entry.reason ?? null,
      metadata: (entry.metadata ?? null) as never,
    })
    if (error) logServerError('writeAuditLog', error, { action: entry.action })
  } catch (e) {
    logServerError('writeAuditLog', e, { action: entry.action })
  }
}
