'use client'

// Work Status card: a per-item status dropdown (writes via updateWorkStatusAction;
// the DB trigger logs history + stamps the timestamp) plus the collapsible work
// history. Renders for any non-void invoice with items (matching the original,
// which did not gate the dropdown by canEdit).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/feedback/toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, cn } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import { WorkStatusBadge } from '@/components/work-status-badge'
import { WorkStatusSelect } from '@/components/work-status-select'
import { WorkStageStepper } from '@/components/work/WorkStageStepper'
import { encodeWork, decodeWork, workLabel, workColor } from '@/lib/work-stages'
import { updateWorkStatusAction } from '@/data/invoice-actions'
import type { InvoiceItem, InvoiceItemStatusHistory, WorkStage } from '@/lib/database.types'

export type WorkStatusEditorProps = {
  items: InvoiceItem[]
  history: InvoiceItemStatusHistory[]
  stages: WorkStage[]
}

export function WorkStatusEditor({ items, history, stages }: WorkStatusEditorProps) {
  const router = useRouter()
  const { show } = useToast()
  const [historyOpen, setHistoryOpen] = useState(false)

  const stagesById = new Map(stages.map(s => [s.id, s]))
  const activeStages = stages.filter(s => s.is_active)

  const updateWorkStatus = async (itemId: string, value: string) => {
    const { work_status, stage_id } = decodeWork(value)
    const res = await updateWorkStatusAction(itemId, { work_status, stage_id })
    if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
    show({ variant: 'success', title: 'Work status updated' })
    router.refresh()
  }

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Work Status</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="w-44">Status</TableHead>
              <TableHead className="w-44 text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(item => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.description}</TableCell>
                <TableCell>
                  <WorkStatusSelect
                    value={encodeWork(item.work_status, item.stage_id)}
                    onValueChange={v => updateWorkStatus(item.id, v)}
                    activeStages={activeStages}
                    workStatus={item.work_status}
                    stageId={item.stage_id}
                    stagesById={stagesById}
                  />
                  <WorkStageStepper
                    activeStages={activeStages}
                    workStatus={item.work_status}
                    stageId={item.stage_id}
                  />
                </TableCell>
                <TableCell className="text-right text-xs text-gray-500">
                  {formatDate(item.work_status_updated_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {history.length > 0 && (
          <div className="border-t">
            <button
              type="button"
              onClick={() => setHistoryOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-600 hover:bg-gray-50"
            >
              <span>Work history ({history.length} change{history.length === 1 ? '' : 's'})</span>
              <ChevronRight className={`h-4 w-4 transition-transform ${historyOpen ? 'rotate-90' : ''}`} />
            </button>
            {historyOpen && (
              <div className="px-4 pb-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map(h => {
                      const item = items.find(i => i.id === h.invoice_item_id)
                      return (
                        <TableRow key={h.id}>
                          <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                            {new Date(h.changed_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-sm">{item?.description ?? '—'}</TableCell>
                          <TableCell>
                            {h.status === 'in_progress' && h.stage_id ? (
                              <span className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                                workColor(h.status, h.stage_id, stagesById),
                              )}>
                                {workLabel(h.status, h.stage_id, stagesById)}
                              </span>
                            ) : (
                              <WorkStatusBadge status={h.status} />
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">
                            {h.changed_by_name ?? '—'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
