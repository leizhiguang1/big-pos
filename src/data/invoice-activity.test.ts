import { describe, it, expect, vi } from 'vitest'

const byTable: Record<string, unknown[]> = {
  invoice_activity_log: [
    { id: 'a1', created_at: '2026-06-30T10:00:00Z', actor_name: 'Alice', action: 'invoice.issued', entity_label: 'INV-1', changes: null, reason: null, metadata: null },
    { id: 'a2', created_at: '2026-06-30T09:00:00Z', actor_name: 'Alice', action: 'invoice.service_status_changed', entity_label: 'INV-1', changes: [{ field: 'service_status_id', label: 'Service status', from: 'svc-1', to: 'svc-2' }], reason: null, metadata: null },
  ],
  invoice_item_status_history: [
    { id: 'h1', invoice_item_id: 'it1', changed_at: '2026-06-30T08:00:00Z', changed_by_name: 'Bob', status: 'received', stage_id: null, invoice_items: { invoice_id: 'inv-1', description: 'Crown' } },
    { id: 'h2', invoice_item_id: 'it1', changed_at: '2026-06-30T11:00:00Z', changed_by_name: 'Bob', status: 'in_progress', stage_id: null, invoice_items: { invoice_id: 'inv-1', description: 'Crown' } },
  ],
  service_statuses: [
    { id: 'svc-1', label: 'Pending' },
    { id: 'svc-2', label: 'Completed' },
  ],
}

vi.mock('@/lib/auth/require-permission', () => ({
  requirePermission: async () => ({ ok: true, userId: 'u1', actorName: 'Alice' }),
}))

vi.mock('@/lib/supabase/admin', () => {
  const qb = (rows: unknown[]) => {
    const result = { data: rows, error: null }
    const o: Record<string, unknown> = {}
    o.select = () => o
    o.eq = () => o
    o.order = () => Promise.resolve(result)
    o.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
    return o
  }
  return { createAdminClient: () => ({ from: (table: string) => qb(byTable[table] ?? []) }) }
})

import { getInvoiceActivity } from './invoice-activity'

describe('getInvoiceActivity', () => {
  it('merges sources newest-first and enriches work + service status', async () => {
    const out = await getInvoiceActivity('inv-1')
    expect(out.map(e => e.action)).toEqual([
      'work_status.changed',          // h2 @ 11:00
      'invoice.issued',               // a1 @ 10:00
      'invoice.service_status_changed', // a2 @ 09:00
      'work_status.changed',          // h1 @ 08:00
    ])
  })

  it('derives work-status from→to as raw enums (prev status per item)', async () => {
    const out = await getInvoiceActivity('inv-1')
    const newest = out[0] // h2: received -> in_progress
    expect(newest.changes?.[0]).toEqual({ field: 'work_status', label: 'Work status', from: 'received', to: 'in_progress' })
    expect(newest.metadata).toMatchObject({ item: 'Crown', fromStatus: 'received', toStatus: 'in_progress' })

    const oldest = out[3] // h1: first change for the item, no prior
    expect(oldest.changes?.[0]).toEqual({ field: 'work_status', label: 'Work status', from: null, to: 'received' })
  })

  it('resolves service-status UUIDs to labels', async () => {
    const out = await getInvoiceActivity('inv-1')
    const svc = out.find(e => e.action === 'invoice.service_status_changed')!
    expect(svc.changes?.[0]).toMatchObject({ from: 'Pending', to: 'Completed' })
  })
})
