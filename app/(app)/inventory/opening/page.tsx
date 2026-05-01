"use client"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

export default function OpeningInventoryPage(): JSX.Element {
  return (
    <PageShell title="Opening Stock" subtitle="Set the initial stock position for the store.">
      <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm max-w-2xl mt-8 text-center mx-auto">
        <h2 className="text-2xl font-black text-slate-800 mb-4">Initial Stock Entry</h2>
        <p className="text-slate-500 mb-6 text-sm leading-relaxed">
          The opening stock is typically set once during the system initialization phase. For daily operations, the opening stock is automatically carried forward from the previous day&apos;s closing stock.
        </p>
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-sm font-bold text-left mb-6">
          To perform an ad-hoc stock correction or a full inventory reset, please navigate to the Physical Count (Closing) module and initiate a recount.
        </div>
        <div className="flex justify-center gap-4">
          <Button onClick={() => window.location.href = "/inventory/closing"} variant="primary">
            Go to Physical Count
          </Button>
          <Button onClick={() => window.location.href = "/inventory"} variant="secondary">
            Back to Inventory Hub
          </Button>
        </div>
      </div>
    </PageShell>
  )
}
