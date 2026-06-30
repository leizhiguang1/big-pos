import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { connect, disconnect, begin, rollback, asServiceRole, asUser, seedUser, seedCustomer, seedInvoice } from './db'

beforeAll(connect)
afterAll(disconnect)
beforeEach(begin)
afterEach(rollback)

async function insertRow(invoiceId: string, actorId: string) {
  await asServiceRole(
    `insert into invoice_activity_log (invoice_id, actor_id, actor_name, action, entity_label)
     values ($1, $2, 'Tester', 'invoice.issued', 'INV-X')`,
    [invoiceId, actorId],
  )
}

describe('invoice_activity_log', () => {
  it('is append-only: UPDATE and DELETE raise', async () => {
    const u = await seedUser(['invoices.manage'])
    const c = await seedCustomer()
    const inv = await seedInvoice({ customerId: c, createdBy: u, total: 100 })
    await insertRow(inv, u)

    await expect(asServiceRole(`update invoice_activity_log set reason = 'x'`)).rejects.toThrow(/append-only/)
    await expect(asServiceRole(`delete from invoice_activity_log`)).rejects.toThrow(/append-only/)
  })

  it('is invisible to authenticated sessions (no RLS policy)', async () => {
    const u = await seedUser(['invoices.view'])
    const c = await seedCustomer()
    const inv = await seedInvoice({ customerId: c, createdBy: u, total: 100 })
    await insertRow(inv, u)

    const res = await asUser(u, 'select * from invoice_activity_log')
    // RLS enabled with no policy → zero rows for an authenticated session.
    expect(res.ok ? res.rows.length : 0).toBe(0)
  })

  it('accepts inserts and reads back via service role', async () => {
    const u = await seedUser(['invoices.manage'])
    const c = await seedCustomer()
    const inv = await seedInvoice({ customerId: c, createdBy: u, total: 100 })
    await insertRow(inv, u)
    const { rows } = await asServiceRole('select action, actor_name from invoice_activity_log where invoice_id = $1', [inv])
    expect(rows).toEqual([{ action: 'invoice.issued', actor_name: 'Tester' }])
  })
})
