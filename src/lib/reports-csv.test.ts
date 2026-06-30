import { describe, it, expect } from 'vitest'
import { buildReportCsv, reportCsvFilename } from './reports-csv'
import type { ReportSummary } from './reports'

const summary: ReportSummary = {
  totalInvoiced: 15180,
  totalPaidInvoices: 160,
  totalOutstanding: 15020,
  invoiceCount: 14,
  outstanding: [
    {
      id: 'o1',
      invoice_number: 'INV-2026-0015',
      status: 'sent',
      total: 1800,
      voided_at: null,
      invoice_date: '2026-06-08',
      due_date: '2026-07-08',
      customers: { clinic_name: 'Dr Ray & Partners Dental Clinic' },
      daysOverdue: -8,
    },
  ],
  paid: [
    {
      id: 'p1',
      invoice_number: 'INV-2026-0001',
      status: 'paid',
      total: 160,
      voided_at: null,
      invoice_date: '2026-06-02',
      due_date: '2026-06-12',
      customers: { clinic_name: 'Origin Dental Clinic' },
    },
  ],
  byCustomer: [
    { name: 'Origin Dental Clinic', total: 4500, count: 2 },
    { name: 'Dr Ray & Partners Dental Clinic', total: 1800, count: 1 },
  ],
  byProduct: [{ name: 'Zirconia Crown', total: 3000, qty: 5 }],
}

const range = { from: '2026-06-01', to: '2026-06-30' }
const GENERATED = '2026-06-30'

describe('buildReportCsv', () => {
  it('writes the title block with company, range, and generated date', () => {
    const csv = buildReportCsv(summary, range, GENERATED)
    expect(csv).toContain('Chi Dental Lab')
    expect(csv).toContain('Sales Report')
    expect(csv).toContain('Range,2026-06-01 to 2026-06-30')
    expect(csv).toContain('Generated,2026-06-30')
  })

  it('emits the summary as a Metric,Value table with 2-dp money', () => {
    const csv = buildReportCsv(summary, range, GENERATED)
    expect(csv).toContain('Metric,Value')
    expect(csv).toContain('Total Invoiced,15180.00')
    expect(csv).toContain('Collected (Paid),160.00')
    expect(csv).toContain('Outstanding,15020.00')
    expect(csv).toContain('Invoice Count,14')
  })

  it('writes outstanding rows (2-dp amount, ISO date, friendly status) + subtotal', () => {
    const csv = buildReportCsv(summary, range, GENERATED)
    expect(csv).toContain('INV-2026-0015,Dr Ray & Partners Dental Clinic,2026-07-08,-8,1800.00,Issued')
    expect(csv).toContain('Subtotal,,,,15020.00,')
    expect(csv).not.toContain('RM')
  })

  it('writes paid rows + subtotal', () => {
    const csv = buildReportCsv(summary, range, GENERATED)
    expect(csv).toContain('INV-2026-0001,Origin Dental Clinic,2026-06-02,160.00,Paid')
    expect(csv).toContain('Subtotal,,,160.00,')
  })

  it('writes the FULL By-Clinic breakdown (all rows) with a Total', () => {
    const csv = buildReportCsv(summary, range, GENERATED)
    expect(csv).toContain('Revenue by Clinic')
    expect(csv).toContain('Origin Dental Clinic,2,4500.00')
    expect(csv).toContain('Dr Ray & Partners Dental Clinic,1,1800.00')
    expect(csv).toContain('Total,3,6300.00')
  })

  it('writes the By-Product breakdown with a Total', () => {
    const csv = buildReportCsv(summary, range, GENERATED)
    expect(csv).toContain('Revenue by Product')
    expect(csv).toContain('Zirconia Crown,5,3000.00')
    expect(csv).toContain('Total,5,3000.00')
  })

  it('quotes fields that contain commas or quotes', () => {
    const csv = buildReportCsv(
      { ...summary, byProduct: [{ name: 'Crown, "Premium"', total: 10, qty: 1 }] },
      range,
      GENERATED,
    )
    expect(csv).toContain('"Crown, ""Premium""",1,10.00')
  })

  it('uses CRLF line endings', () => {
    expect(buildReportCsv(summary, range, GENERATED)).toContain('\r\n')
  })

  it('handles empty sections without crashing', () => {
    const empty: ReportSummary = {
      totalInvoiced: 0,
      totalPaidInvoices: 0,
      totalOutstanding: 0,
      invoiceCount: 0,
      outstanding: [],
      paid: [],
      byCustomer: [],
      byProduct: [],
    }
    const csv = buildReportCsv(empty, range, GENERATED)
    expect(csv).toContain('Total Invoiced,0.00')
    expect(csv).toContain('Revenue by Clinic')
    expect(csv).toContain('Total,0,0.00')
  })
})

describe('reportCsvFilename', () => {
  it('includes the date range', () => {
    expect(reportCsvFilename(range)).toBe('sales-report_2026-06-01_2026-06-30.csv')
  })
})
