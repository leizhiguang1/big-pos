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
import { Textarea } from '@/components/ui/textarea'
import { formatDate, cn } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import { WorkStatusBadge } from '@/components/work-status-badge'
import { WorkStatusSelect } from '@/components/work-status-select'
import { WorkStageStepper } from '@/components/work/WorkStageStepper'
import { encodeWork, decodeWork, workLabel, workColor } from '@/lib/work-stages'
import { updateWorkStatusAction, updateWorkNoteAction } from '@/data/invoice-actions'
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

  const saveWorkNote = async (itemId: string, note: string) => {
    const res = await updateWorkNoteAction(itemId, note)
    if (res.ok === false) { show({ variant: 'error', title: res.error }); return false }
    show({ variant: 'success', title: 'Work note saved' })
    router.refresh()
    return true
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
              <TableRow key={item.id} className="align-top">
                <TableCell className="font-medium">
                  {item.description}
                  {/* Internal work note — surfaced + editable here, kept off the
                      printed customer invoice (prints on the Wave 3 work ticket). */}
                  <WorkNoteCell
                    itemId={item.id}
                    note={item.work_note}
                    onSave={saveWorkNote}
                  />
                </TableCell>
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

// Per-item internal work note. Collapsed by default to a one-line preview (or an
// "Add note" affordance when empty); expands to an editable textarea with
// Save/Cancel. Saves through updateWorkNoteAction; the parent router.refresh()
// re-renders with the persisted value.
function WorkNoteCell({
  itemId,
  note,
  onSave,
}: {
  itemId: string
  note: string | null
  onSave: (itemId: string, note: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note ?? '')
  const [saving, setSaving] = useState(false)

  const startEditing = () => {
    setDraft(note ?? '')
    setEditing(true)
  }

  const cancel = () => {
    setDraft(note ?? '')
    setEditing(false)
  }

  const save = async () => {
    setSaving(true)
    const ok = await onSave(itemId, draft)
    setSaving(false)
    if (ok) setEditing(false)
  }

  if (!editing) {
    return note ? (
      <button
        type="button"
        onClick={startEditing}
        className="mt-1 block text-left text-xs font-normal text-gray-600 hover:text-gray-900"
        title="Edit work note"
      >
        <span className="text-gray-400">Note:</span> {note}
      </button>
    ) : (
      <button
        type="button"
        onClick={startEditing}
        className="mt-1 block text-left text-xs font-normal text-gray-400 hover:text-gray-600"
      >
        + Add note
      </button>
    )
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      <Textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="Internal work note (not printed on invoice)"
        rows={2}
        className="min-h-[56px] text-xs font-normal"
        autoFocus
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
