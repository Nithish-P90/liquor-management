'use client'
import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'

type MiscCategory = 'CIGARETTES' | 'SNACKS' | 'CUPS'

type MiscItem = {
  id: number
  barcode: string
  name: string
  category: MiscCategory
  price: number
}

type CartItem = {
  item: MiscItem
  quantity: number
}

type SaleRecord = {
  id: number
  quantity: number
  unitPrice: number
  totalAmount: number
  saleTime: string
  item: MiscItem
}

const CAT_LABEL: Record<MiscCategory, string> = {
  CIGARETTES: 'Cigarettes',
  SNACKS: 'Snacks',
  CUPS: 'Cups',
}

const CAT_COLOR: Record<MiscCategory, string> = {
  CIGARETTES: 'border-l-amber-500',
  SNACKS: 'border-l-emerald-500',
  CUPS: 'border-l-blue-500',
}

function rupee(n: number) {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

export default function MiscSalePage() {
  const { data: session } = useSession()
  const user = session?.user as { role?: string } | undefined
  const canManageItems = user?.role === 'ADMIN' || user?.role === 'CASHIER'

  const [barcode, setBarcode] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [flash, setFlash] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)

  // All misc items list
  const [allItems, setAllItems] = useState<MiscItem[]>([])
  const [showManage, setShowManage] = useState(false)

  // Register / edit modal
  const [registerModal, setRegisterModal] = useState<{ addToCartOnSave: boolean } | null>(null)
  const [regForm, setRegForm] = useState({ barcode: '', name: '', category: 'CIGARETTES' as MiscCategory, price: '' })

  // Edit modal
  const [editItem, setEditItem] = useState<MiscItem | null>(null)
  const [editForm, setEditForm] = useState({ name: '', category: 'CIGARETTES' as MiscCategory, price: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadSales() }, [date])
  useEffect(() => { if (canManageItems) loadAllItems() }, [canManageItems])

  function loadAllItems() {
    fetch('/api/misc-items')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAllItems(data) })
  }

  function openRegisterModal(defaultBarcode = '', addToCartOnSave = false) {
    setRegisterModal({ addToCartOnSave })
    setRegForm({ barcode: defaultBarcode, name: '', category: 'CIGARETTES', price: '' })
  }

  function loadSales() {
    setLoading(true)
    fetch(`/api/misc-sales?date=${date}`)
      .then(async r => {
        const data: unknown = await r.json().catch(() => [])
        if (!r.ok) {
          showFlash('Failed to load misc sales totals', 'err')
          setSales([])
          return
        }
        setSales(Array.isArray(data) ? data as SaleRecord[] : [])
      })
      .catch(() => {
        showFlash('Failed to load misc sales totals', 'err')
        setSales([])
      })
      .finally(() => setLoading(false))
  }

  async function handleScan() {
    const bc = barcode.trim()
    if (!bc) return
    setBarcode('')

    const res = await fetch(`/api/misc-items?barcode=${encodeURIComponent(bc)}`)
    const item: MiscItem | null = await res.json()

    if (!item) {
      if (!canManageItems) {
        showFlash('Only admins and cashiers can add new items', 'err')
        return
      }
      openRegisterModal(bc, true)
      return
    }

    addToCart({ ...item, price: Number(item.price) })
    barcodeRef.current?.focus()
  }

  function addToCart(item: MiscItem) {
    setCart(prev => {
      const idx = prev.findIndex(c => c.item.id === item.id)
      if (idx >= 0) return prev.map((c, i) => i === idx ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { item, quantity: 1 }]
    })
  }

  async function registerItem() {
    if (!registerModal) return

    const cleanBarcode = regForm.barcode.trim()
    const cleanName = regForm.name.trim()
    const price = parseFloat(regForm.price)

    if (!cleanBarcode || !cleanName || !Number.isFinite(price) || price <= 0) {
      showFlash('Barcode, name and valid price are required', 'err')
      return
    }

    const res = await fetch('/api/misc-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        barcode: cleanBarcode,
        name: cleanName,
        category: regForm.category,
        price,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      showFlash(data.error ?? 'Failed to add item', 'err')
      return
    }

    const item: MiscItem = await res.json()
    setRegisterModal(null)
    if (registerModal.addToCartOnSave) {
      addToCart({ ...item, price: Number(item.price) })
    }
    showFlash('Item added successfully', 'ok')
    barcodeRef.current?.focus()
  }

  function openEditModal(item: MiscItem) {
    setEditItem(item)
    setEditForm({ name: item.name, category: item.category, price: String(item.price) })
  }

  async function saveEdit() {
    if (!editItem) return
    const price = parseFloat(editForm.price)
    if (!editForm.name.trim() || !Number.isFinite(price) || price <= 0) {
      showFlash('Name and valid price are required', 'err'); return
    }
    setEditSaving(true)
    const res = await fetch('/api/misc-items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editItem.id, name: editForm.name.trim(), category: editForm.category, price }),
    })
    setEditSaving(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); showFlash(d.error ?? 'Failed to save', 'err'); return }
    setEditItem(null)
    showFlash('Item updated', 'ok')
    loadAllItems()
  }

  async function confirmDelete(id: number) {
    const res = await fetch('/api/misc-items', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setDeleteConfirmId(null)
    if (!res.ok) { const d = await res.json().catch(() => ({})); showFlash(d.error ?? 'Failed to delete', 'err'); return }
    showFlash('Item deleted', 'ok')
    loadAllItems()
  }

  const cartTotal = cart.reduce((s, c) => s + c.item.price * c.quantity, 0)

  async function charge() {
    if (cart.length === 0) return
    const res = await fetch('/api/misc-sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map(c => ({
          itemId: c.item.id,
          quantity: c.quantity,
          unitPrice: c.item.price,
          totalAmount: c.item.price * c.quantity,
        })),
        saleDate: date,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      showFlash(data.error ?? 'Failed to record misc sale', 'err')
      return
    }

    setCart([])
    showFlash('Sale recorded!', 'ok')
    loadSales()
    barcodeRef.current?.focus()
  }

  function showFlash(msg: string, type: 'ok' | 'err') {
    setFlash({ msg, type })
    setTimeout(() => setFlash(null), 2500)
  }

  // Build tally
  const tally = Object.values(
    sales.reduce<Record<string, { name: string; category: MiscCategory; qty: number; amount: number }>>((acc, s) => {
      const key = `${s.item.category}__${s.item.name}`
      if (!acc[key]) acc[key] = { name: s.item.name, category: s.item.category, qty: 0, amount: 0 }
      acc[key].qty += s.quantity
      acc[key].amount += Number(s.totalAmount)
      return acc
    }, {})
  )

  const catTotals = (['CIGARETTES', 'SNACKS', 'CUPS'] as MiscCategory[]).map(cat => ({
    cat,
    qty: tally.filter(t => t.category === cat).reduce((s, t) => s + t.qty, 0),
    amount: tally.filter(t => t.category === cat).reduce((s, t) => s + t.amount, 0),
  }))

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Miscellaneous Sales</h1>
          <p className="text-slate-400 text-sm mt-0.5">Cigarettes · Snacks · Cups</p>
        </div>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>

      {/* Flash */}
      {flash && (
        <div className={`px-4 py-2.5 rounded-lg text-sm font-semibold border ${flash.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {flash.msg}
        </div>
      )}

      {/* Barcode input */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex gap-2">
        <input
          ref={barcodeRef}
          value={barcode}
          onChange={e => setBarcode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleScan()}
          placeholder="Scan barcode or type and press Enter..."
          className="flex-1 px-4 py-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          autoFocus
        />
        <button
          onClick={handleScan}
          className="px-5 py-3 bg-blue-600 text-white font-bold rounded-lg text-sm hover:bg-blue-700 transition-colors"
        >
          Add
        </button>
        {canManageItems && (
          <>
            <button
              onClick={() => openRegisterModal('', false)}
              className="px-5 py-3 bg-slate-700 text-white font-bold rounded-lg text-sm hover:bg-slate-800 transition-colors"
            >
              + Add
            </button>
            <button
              onClick={() => setShowManage(v => !v)}
              className={`px-5 py-3 font-bold rounded-lg text-sm transition-colors border ${showManage ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              Manage Items
            </button>
          </>
        )}
      </div>

      {/* Manage Items panel */}
      {showManage && canManageItems && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">Item Catalogue</h2>
            <span className="text-xs text-slate-400">{allItems.length} item(s)</span>
          </div>
          {allItems.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No items yet. Add one above.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-400">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400">Category</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 font-mono">Barcode</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400">Price</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {allItems.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50 group">
                    <td className="px-5 py-3 font-medium text-slate-800">{item.name}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-500">{CAT_LABEL[item.category]}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{item.barcode}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800">{rupee(Number(item.price))}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditModal(item)}
                          className="px-2.5 py-1 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                        >Edit</button>
                        <button
                          onClick={() => setDeleteConfirmId(item.id)}
                          className="px-2.5 py-1 text-xs font-bold text-red-500 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                        >Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Cart */}
      {cart.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-700">Current Bill</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {cart.map((c, i) => (
              <div key={i} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{c.item.name}</p>
                  <p className="text-xs text-slate-400">{CAT_LABEL[c.item.category]} · {rupee(c.item.price)} each</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setCart(prev => prev.map((x, j) => j === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}
                    className="w-7 h-7 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 font-bold flex items-center justify-center text-base"
                  >−</button>
                  <span className="text-sm font-bold w-5 text-center">{c.quantity}</span>
                  <button
                    onClick={() => setCart(prev => prev.map((x, j) => j === i ? { ...x, quantity: x.quantity + 1 } : x))}
                    className="w-7 h-7 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 font-bold flex items-center justify-center text-base"
                  >+</button>
                </div>
                <span className="text-sm font-bold text-slate-900 w-16 text-right flex-shrink-0">{rupee(c.item.price * c.quantity)}</span>
                <button
                  onClick={() => setCart(prev => prev.filter((_, j) => j !== i))}
                  className="text-slate-300 hover:text-red-500 text-xl flex-shrink-0 leading-none"
                >×</button>
              </div>
            ))}
          </div>
          <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-4">
            <div className="text-xs font-semibold text-slate-500">
              Separate misc ledger entry
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm font-bold text-slate-700">Total: {rupee(cartTotal)}</span>
              <button
                onClick={charge}
                className="px-6 py-2.5 bg-emerald-600 text-white font-bold rounded-lg text-sm hover:bg-emerald-700 transition-colors"
              >Charge</button>
            </div>
          </div>
        </div>
      )}

      {/* Category summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {catTotals.map(({ cat, qty, amount }) => (
          <div key={cat} className={`bg-white border border-slate-200 border-l-4 ${CAT_COLOR[cat]} rounded-xl p-5`}>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{CAT_LABEL[cat]}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{qty} <span className="text-sm font-normal text-slate-400">sold</span></p>
            <p className="text-sm font-semibold text-slate-600 mt-0.5">{rupee(amount)}</p>
          </div>
        ))}
      </div>

      {/* Product-wise tally */}
      {loading ? (
        <div className="flex items-center justify-center h-24">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tally.length > 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-700">Product-wise Tally</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400">Product</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-400">Category</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-400">Qty</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {tally.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3 text-center text-xs font-semibold text-slate-500">{CAT_LABEL[r.category]}</td>
                  <td className="px-4 py-3 text-center font-bold text-slate-700">{r.qty}</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-900">{rupee(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Register item modal */}
      {registerModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-80 shadow-xl">
            <h2 className="text-base font-bold text-slate-800 mb-1">Register New Item</h2>
            <p className="text-xs text-slate-400 mb-4">Name, price and barcode will also sync to POS.</p>
            <div className="space-y-3">
              <input
                value={regForm.barcode}
                onChange={e => setRegForm(f => ({ ...f, barcode: e.target.value }))}
                placeholder="Barcode"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <input
                autoFocus
                value={regForm.name}
                onChange={e => setRegForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Product name (e.g. Gold Flake Kings)"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={regForm.category}
                onChange={e => setRegForm(f => ({ ...f, category: e.target.value as MiscCategory }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="CIGARETTES">Cigarettes</option>
                <option value="SNACKS">Snacks</option>
                <option value="CUPS">Cups</option>
              </select>
              <input
                type="number"
                value={regForm.price}
                onChange={e => setRegForm(f => ({ ...f, price: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && registerItem()}
                placeholder="Price per unit (₹)"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setRegisterModal(null); barcodeRef.current?.focus() }}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-500 rounded-lg text-sm font-semibold hover:bg-slate-50"
              >Cancel</button>
              <button
                onClick={registerItem}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700"
              >{registerModal.addToCartOnSave ? 'Register & Add' : 'Register'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit item modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-80 shadow-xl">
            <h2 className="text-base font-bold text-slate-800 mb-1">Edit Item</h2>
            <p className="text-xs text-slate-400 mb-4">Update item name, category and price.</p>
            <div className="space-y-3">
              <div className="px-3 py-2.5 border border-slate-200 rounded-lg text-xs font-mono text-slate-500 bg-slate-50">
                {editItem.barcode}
              </div>
              <input
                autoFocus
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Product name"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={editForm.category}
                onChange={e => setEditForm(f => ({ ...f, category: e.target.value as MiscCategory }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="CIGARETTES">Cigarettes</option>
                <option value="SNACKS">Snacks</option>
                <option value="CUPS">Cups</option>
              </select>
              <input
                type="number"
                value={editForm.price}
                onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && saveEdit()}
                placeholder="Price per unit (₹)"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setEditItem(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-500 rounded-lg text-sm font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
              >
                {editSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirmId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-80 shadow-xl">
            <h2 className="text-base font-bold text-slate-800 mb-2">Delete Item?</h2>
            <p className="text-sm text-slate-500 mb-4">This will remove the item from misc sales list.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-500 rounded-lg text-sm font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDelete(deleteConfirmId)}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
