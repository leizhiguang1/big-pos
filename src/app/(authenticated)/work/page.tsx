// Work queue — server-first. The page is an async Server Component that reads the
// queue through the `src/data/` seam (RLS-aware SSR client) and hands plain,
// serializable rows/stages to the client island, which owns the interactive UI
// (Board/List toggle, Kanban DnD, item-based list, filter, search, optimistic moves).

import { getWorkQueue } from '@/data/work'
import { WorkViewToggle } from '@/components/work/WorkViewToggle'

export default async function WorkPage() {
  const { rows, stages, statusConfigs } = await getWorkQueue()
  return <WorkViewToggle rows={rows} stages={stages} statusConfigs={statusConfigs} />
}
