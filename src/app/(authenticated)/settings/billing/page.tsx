import { getBillingSettings } from '@/data/billing-settings'
import { BillingSettingsForm } from '@/components/settings/BillingSettingsForm'

export default async function BillingSettingsPage() {
  const settings = await getBillingSettings()

  return (
    <div className="w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Billing</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Bank details and invoice footer text.</p>
      </div>
      <BillingSettingsForm settings={settings} />
    </div>
  )
}
