import { describe, it, expect, vi } from 'vitest'

const insert = vi.fn().mockResolvedValue({ error: null })
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ insert }) }),
}))

import { writeAuditLog } from './audit-log'

describe('writeAuditLog', () => {
  it('inserts a normalized audit row', async () => {
    await writeAuditLog({
      actorId: 'u1', action: 'invoice.purge', entityType: 'invoice',
      entityId: 'i1', entityLabel: 'INV-1042', reason: 'duplicate',
      metadata: { total: 50 },
    })
    expect(insert).toHaveBeenCalledWith({
      actor_id: 'u1', action: 'invoice.purge', entity_type: 'invoice',
      entity_id: 'i1', entity_label: 'INV-1042', reason: 'duplicate',
      metadata: { total: 50 },
    })
  })

  it('defaults optional fields to null', async () => {
    insert.mockClear()
    await writeAuditLog({ actorId: 'u2', action: 'invoice.restore', entityType: 'invoice' })
    expect(insert).toHaveBeenCalledWith({
      actor_id: 'u2', action: 'invoice.restore', entity_type: 'invoice',
      entity_id: null, entity_label: null, reason: null, metadata: null,
    })
  })

  it('never throws when the insert errors', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'boom' } })
    await expect(writeAuditLog({ actorId: 'u3', action: 'credit.delete', entityType: 'credit' })).resolves.toBeUndefined()
  })
})
