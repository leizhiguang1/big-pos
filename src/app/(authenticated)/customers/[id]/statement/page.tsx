// Statement of Account — Server Component.
// Fetches clinic + its open invoices, builds the derived statement,
// and renders a print-clean A4 document wrapped in #invoice-print
// (picked up by the @media print rule in globals.css).

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getClinicStatement } from '@/data/customers'
import { buildStatement } from '@/lib/statement'
import { COMPANY } from '@/lib/config'
import { formatCurrency, formatDate, todayISODate } from '@/lib/utils'
import { CREDIT_REASON_LABELS } from '@/lib/credit'
import { StatementPrintButton } from '@/components/StatementPrintButton'

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const bundle = await getClinicStatement(id)
  if (!bundle) notFound()

  const { clinic, invoices, payments, credits } = bundle
  const today = todayISODate()
  const stmt = buildStatement(invoices, payments, credits, today)

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Toolbar — hidden on print */}
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/customers/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Clinic
          </Link>
        </Button>
        <StatementPrintButton />
      </div>

      {/* Printable document */}
      <div
        id="invoice-print"
        className="bg-card border border-border rounded-lg p-8 print:border-0 print:p-6 print:shadow-none text-foreground"
      >
        {/* ── Letterhead ─────────────────────────────────────────────────── */}
        <div className="flex justify-between items-start mb-8">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/chidental-rectangle.png"
              alt={COMPANY.name}
              className="max-h-12 max-w-[220px] object-contain object-left mb-2"
            />
            <div className="text-sm text-muted-foreground whitespace-pre-line">{COMPANY.address}</div>
            {COMPANY.phone && <div className="text-sm text-muted-foreground">Tel: {COMPANY.phone}</div>}
            {COMPANY.email && <div className="text-sm text-muted-foreground">{COMPANY.email}</div>}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-muted-foreground uppercase tracking-widest mb-2">
              Statement of Account
            </div>
            <div className="text-sm text-muted-foreground space-y-0.5">
              <div>
                <span className="text-muted-foreground">Date: </span>
                <span className="font-semibold text-foreground">{formatDate(today)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Clinic block ───────────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">To</div>
          <div className="font-semibold text-foreground text-base">{clinic.clinic_name}</div>
          {clinic.contact_person && (
            <div className="text-sm text-muted-foreground">{clinic.contact_person}</div>
          )}
          {clinic.ssm_no && (
            <div className="text-sm text-muted-foreground">SSM: {clinic.ssm_no}</div>
          )}
          {clinic.billing_address && (
            <div className="text-sm text-muted-foreground whitespace-pre-line mt-0.5">
              {clinic.billing_address}
            </div>
          )}
        </div>

        {/* ── Open-item table ────────────────────────────────────────────── */}
        {stmt.lines.length > 0 ? (
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b-2 border-border">
                <th className="text-left py-2 text-muted-foreground font-medium">Date</th>
                <th className="text-left py-2 text-muted-foreground font-medium">Invoice #</th>
                <th className="text-left py-2 text-muted-foreground font-medium">Patient</th>
                <th className="text-right py-2 text-muted-foreground font-medium tabular-nums">Amount</th>
                <th className="text-right py-2 text-muted-foreground font-medium tabular-nums">Paid</th>
                <th className="text-right py-2 text-muted-foreground font-medium tabular-nums">Balance</th>
              </tr>
            </thead>
            <tbody>
              {stmt.lines.map((line) => (
                <tr key={line.number} className="border-b border-border">
                  <td className="py-2.5 text-foreground">{formatDate(line.date)}</td>
                  <td className="py-2.5 text-foreground font-mono text-xs">{line.number}</td>
                  <td className="py-2.5 text-muted-foreground">{line.patient ?? '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-foreground">{formatCurrency(line.total)}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                    {line.paid > 0 ? formatCurrency(line.paid) : '—'}
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold text-foreground">
                    {formatCurrency(line.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border">
                <td colSpan={3} className="pt-3 text-right text-sm text-muted-foreground">
                  Total Billed
                </td>
                <td className="pt-3 text-right tabular-nums font-semibold text-foreground">
                  {formatCurrency(stmt.totalBilled)}
                </td>
                <td />
                <td />
              </tr>
              <tr>
                <td colSpan={3} className="pt-1 text-right text-sm text-muted-foreground">
                  Total Paid
                </td>
                <td />
                <td className="pt-1 text-right tabular-nums font-semibold text-foreground">
                  {formatCurrency(stmt.totalPaid)}
                </td>
                <td />
              </tr>
              {/* Credits are a non-payment reduction of the clinic's account —
                  shown as an explicit "Less: account credits" line so the math
                  to the closing balance is legible. */}
              {stmt.totalCredits > 0 && (
                <tr>
                  <td colSpan={3} className="pt-1 text-right text-sm text-muted-foreground">
                    Less: account credits
                  </td>
                  <td />
                  <td />
                  <td className="pt-1 text-right tabular-nums font-semibold text-foreground">
                    −{formatCurrency(stmt.totalCredits)}
                  </td>
                </tr>
              )}
              <tr>
                <td colSpan={3} className="pt-2 text-right text-sm font-bold text-foreground">
                  {stmt.totalCredits > 0 ? 'Account Balance' : 'Balance Due'}
                </td>
                <td />
                <td />
                <td className="pt-2 text-right tabular-nums text-lg font-bold text-foreground">
                  {formatCurrency(stmt.balance)}
                </td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <div className="py-12 text-center text-muted-foreground text-sm mb-6">
            No outstanding invoices.
          </div>
        )}

        {/* ── Account credits ledger ─────────────────────────────────────── */}
        {stmt.credits.length > 0 && (
          <div className="mb-8">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Account Credits
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 text-muted-foreground font-medium">Date</th>
                  <th className="text-left py-1.5 text-muted-foreground font-medium">Reason</th>
                  <th className="text-left py-1.5 text-muted-foreground font-medium">Against</th>
                  <th className="text-right py-1.5 text-muted-foreground font-medium tabular-nums">Amount</th>
                </tr>
              </thead>
              <tbody>
                {stmt.credits.map((c, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-2 text-foreground">{formatDate(c.date)}</td>
                    <td className="py-2 text-foreground">
                      Credit — {CREDIT_REASON_LABELS[c.reason as keyof typeof CREDIT_REASON_LABELS] ?? c.reason}
                    </td>
                    <td className="py-2 text-muted-foreground font-mono text-xs">{c.number ?? '—'}</td>
                    <td className="py-2 text-right tabular-nums text-foreground">−{formatCurrency(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── A/R Aging ──────────────────────────────────────────────────── */}
        {stmt.balance > 0 && (
          <div className="mb-8">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              A/R Aging Summary
            </div>
            <table className="text-sm">
              <thead>
                <tr className="border-b border-border">
                  {(['Current', '1–30 days', '31–60 days', '61–90 days', '90+ days', 'Total'] as const).map((h) => (
                    <th key={h} className="text-right py-1.5 pr-6 last:pr-0 text-muted-foreground font-medium tabular-nums">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {[
                    stmt.aging.current,
                    stmt.aging.d1_30,
                    stmt.aging.d31_60,
                    stmt.aging.d61_90,
                    stmt.aging.d90plus,
                    stmt.aging.total,
                  ].map((val, i) => (
                    <td
                      key={i}
                      className={`py-1.5 pr-6 last:pr-0 text-right tabular-nums font-semibold ${
                        i === 4 && val > 0 ? 'text-destructive' : 'text-foreground'
                      }`}
                    >
                      {formatCurrency(val)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="border-t border-border pt-4 text-xs text-muted-foreground">
          Terms: Net 30
        </div>
      </div>
    </div>
  )
}
