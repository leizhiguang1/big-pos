import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth/require-permission'

export interface TimelineEvent {
  id: string
  at: string
  actorName: string
  action: string
  entityLabel?: string | null
  changes?: { field: string; label: string; from: unknown; to: unknown }[] | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
}

type ActivityRow = {
  id: string; created_at: string; actor_name: string; action: string
  entity_label: string | null; changes: unknown; reason: string | null
  metadata: Record<string, unknown> | null
}
type HistoryRow = {
  id: string; invoice_item_id: string; changed_at: string; changed_by_name: string | null
  status: string; stage_id: string | null
  invoice_items: { invoice_id: string; description: string | null } | null
}

// Per-invoice timeline: explicit activity-log events + work-status changes from the
// existing trigger table (no invoice_id there — filter via invoice_items). Gated by
// invoices.view; reads via the admin client (the page is already gated, RLS has no
// client policy). Merge + sort in TypeScript.
//
// Enrichment: work-status events are rendered "from → to", but the history table
// only records the NEW status, so the previous status is derived per item (the
// preceding row by time). Status enums and service-status UUIDs are resolved to
// their configured labels so the timeline reads in plain language.
export async function getInvoiceActivity(invoiceId: string): Promise<TimelineEvent[]> {
  const gate = await requirePermission('invoices.view')
  if (!gate.ok) return []
  const admin = createAdminClient()

  const [{ data: activity }, { data: history }, { data: svcStatuses }] = await Promise.all([
    admin
      .from('invoice_activity_log')
      .select('id, created_at, actor_name, action, entity_label, changes, reason, metadata')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false }),
    admin
      .from('invoice_item_status_history')
      .select('id, invoice_item_id, changed_at, changed_by_name, status, stage_id, invoice_items!inner(invoice_id, description)')
      .eq('invoice_items.invoice_id', invoiceId)
      .order('changed_at', { ascending: true }),
    admin.from('service_statuses').select('id, label'),
  ])

  const svcLabel = new Map<string, string>(((svcStatuses ?? []) as { id: string; label: string }[]).map(s => [s.id, s.label]))
  const labelSvc = (s: unknown): unknown => (s ? (svcLabel.get(String(s)) ?? s) : s)

  const fromActivity: TimelineEvent[] = ((activity ?? []) as ActivityRow[]).map(r => {
    let changes = (r.changes ?? null) as TimelineEvent['changes']
    // Resolve service-status UUIDs to human labels for display.
    if (r.action === 'invoice.service_status_changed' && Array.isArray(changes)) {
      changes = changes.map(c =>
        c.field === 'service_status_id'
          ? { ...c, label: 'Service status', from: labelSvc(c.from), to: labelSvc(c.to) }
          : c,
      )
    }
    return {
      id: r.id, at: r.created_at, actorName: r.actor_name, action: r.action,
      entityLabel: r.entity_label, changes, reason: r.reason, metadata: r.metadata,
    }
  })

  // Group work-status history by item to derive each change's previous status.
  const byItem = new Map<string, HistoryRow[]>()
  for (const r of (history ?? []) as unknown as HistoryRow[]) {
    const arr = byItem.get(r.invoice_item_id) ?? []
    arr.push(r)
    byItem.set(r.invoice_item_id, arr)
  }
  // Work-status events carry the RAW status enums (not labels) so the panel can
  // render them with the configured colour via WorkStatusBadge.
  const fromHistory: TimelineEvent[] = []
  for (const rows of byItem.values()) {
    rows.sort((a, b) => (a.changed_at < b.changed_at ? -1 : a.changed_at > b.changed_at ? 1 : 0))
    rows.forEach((r, i) => {
      const prev = i > 0 ? rows[i - 1].status : null
      fromHistory.push({
        id: `ws-${r.id}`, at: r.changed_at, actorName: r.changed_by_name ?? '(unknown)',
        action: 'work_status.changed', entityLabel: null,
        changes: [{ field: 'work_status', label: 'Work status', from: prev, to: r.status }],
        metadata: { item: r.invoice_items?.description ?? null, fromStatus: prev, toStatus: r.status },
      })
    })
  }

  return [...fromActivity, ...fromHistory].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}
