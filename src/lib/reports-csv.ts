// Builds the Sales Reports page as a single clean, downloadable CSV. Pure (no
// DOM/Blob) so it's unit-testable; the client island handles the download.
// Money is 2-dp (still a plain number Excel can sum) and dates are ISO. Sections
// carry titles, header rows, and totals; breakdowns include every row.

import type { ReportSummary } from './reports'
import { paymentStatusLabel } from './status-badge'
import { COMPANY } from './config'

// RFC 4180 field escaping: wrap in quotes when the value contains a comma,
// quote, or newline, doubling any embedded quotes.
function csvField(value: string | number): string {
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function row(fields: Array<string | number>): string {
  return fields.map(csvField).join(',')
}

// Consistent 2-decimal money; still a plain number for spreadsheet math.
const money = (n: number): string => Number(n).toFixed(2)

export function reportCsvFilename(range: { from: string; to: string }): string {
  return `sales-report_${range.from}_${range.to}.csv`
}

export function buildReportCsv(
  summary: ReportSummary,
  range: { from: string; to: string },
  generatedOn: string,
): string {
  const { totalInvoiced, totalPaidInvoices, totalOutstanding, invoiceCount, outstanding, paid, byCustomer, byProduct } =
    summary
  const lines: string[] = []

  // Title block
  lines.push(row([COMPANY.name]))
  lines.push(row(['Sales Report']))
  lines.push(row(['Range', `${range.from} to ${range.to}`]))
  lines.push(row(['Generated', generatedOn]))
  lines.push('')

  // Summary
  lines.push(row(['Summary']))
  lines.push(row(['Metric', 'Value']))
  lines.push(row(['Total Invoiced', money(totalInvoiced)]))
  lines.push(row(['Collected (Paid)', money(totalPaidInvoices)]))
  lines.push(row(['Outstanding', money(totalOutstanding)]))
  lines.push(row(['Invoice Count', invoiceCount]))
  lines.push('')

  // Outstanding invoices (full list + subtotal)
  lines.push(row(['Outstanding Invoices']))
  lines.push(row(['Invoice #', 'Clinic', 'Due Date', 'Days Overdue', 'Amount', 'Status']))
  for (const inv of outstanding) {
    lines.push(
      row([
        inv.invoice_number,
        inv.customers?.clinic_name ?? '',
        inv.due_date,
        inv.daysOverdue,
        money(Number(inv.total)),
        paymentStatusLabel(inv.status),
      ]),
    )
  }
  lines.push(row(['Subtotal', '', '', '', money(totalOutstanding), '']))
  lines.push('')

  // Paid invoices (full list + subtotal)
  lines.push(row(['Paid Invoices']))
  lines.push(row(['Invoice #', 'Clinic', 'Invoice Date', 'Amount', 'Status']))
  for (const inv of paid) {
    lines.push(
      row([
        inv.invoice_number,
        inv.customers?.clinic_name ?? '',
        inv.invoice_date,
        money(Number(inv.total)),
        paymentStatusLabel(inv.status),
      ]),
    )
  }
  lines.push(row(['Subtotal', '', '', money(totalPaidInvoices), '']))
  lines.push('')

  // Revenue by clinic (all rows + total)
  lines.push(row(['Revenue by Clinic']))
  lines.push(row(['Clinic', 'Invoices', 'Total']))
  let clinicCount = 0
  let clinicTotal = 0
  for (const c of byCustomer) {
    lines.push(row([c.name, c.count, money(c.total)]))
    clinicCount += c.count
    clinicTotal += c.total
  }
  lines.push(row(['Total', clinicCount, money(clinicTotal)]))
  lines.push('')

  // Revenue by product (all rows + total)
  lines.push(row(['Revenue by Product']))
  lines.push(row(['Product', 'Quantity', 'Total']))
  let productQty = 0
  let productTotal = 0
  for (const p of byProduct) {
    lines.push(row([p.name, p.qty, money(p.total)]))
    productQty += p.qty
    productTotal += p.total
  }
  lines.push(row(['Total', productQty, money(productTotal)]))

  return lines.join('\r\n')
}
