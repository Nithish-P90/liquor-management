'use client'
import { useEffect, useState } from 'react'
import { WebcamBarcodeScanner } from '@/components/WebcamBarcodeScanner'

const CATEGORIES = ['ALL', 'BRANDY', 'WHISKY', 'RUM', 'VODKA', 'GIN', 'WINE', 'PREMIX', 'BEER', 'BEVERAGE']

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('ALL')
  const [showAdd, setShowAdd] = useState(false)
  const [editProduct, setEditProduct] = useState<any | null>(null)
  const [editBarcode, setEditBarcode] = useState<{ productSizeId: number; barcode: string } | null>(null)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  async function load() {
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (category !== 'ALL') params.set('category', category)
    const data = await fetch(`/api/products?${params}`).then(r => r.json())
    setProducts(data); setLoading(false)
  }

  useEffect(() => { load() }, [search, category])

  async function updateBarcode() {
    if (!editBarcode) return
    await fetch(`/api/products/${editBarcode.productSizeId}/barcode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: editBarcode.barcode }),
    })
    setEditBarcode(null); load()
  }

  async function deleteProduct(productId: number) {
    const product = products.find(p => p.id === productId)
    const label = product ? product.name : 'this product'
    const confirmed = window.confirm(`Delete ${label}? This action cannot be undone.`)
    if (!confirmed) return

    const res = await fetch(`/api/products/${productId}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      window.alert(data.error ?? 'Unable to delete product')
      return
    }

    setOpenMenuId(null)
    load()
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Products Registry</h1>
        <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
          + Add Product
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search products..." className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64" />
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${category === c ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-visible">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Product</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Category</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Item Code</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Sizes & Pricing</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Barcode</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {products.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 relative">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${categoryColor(p.category)}`}>{p.category}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.itemCode}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {p.sizes.map((s: any) => (
                        <div key={s.id} className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-500 w-12">{s.sizeMl}ml</span>
                          <span className="text-xs text-gray-400">MRP ₹{Number(s.mrp).toLocaleString('en-IN')}</span>
                          <span className="text-xs font-semibold text-blue-700">Sell ₹{Number(s.sellingPrice).toLocaleString('en-IN')}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {p.sizes.map((s: any) => (
                        <div key={s.id} className="flex items-center gap-1">
                          <span className="text-xs text-gray-400">{s.sizeMl}ml:</span>
                          {s.barcode ? (
                            <span className="font-mono text-xs text-gray-600">{s.barcode}</span>
                          ) : (
                            <button onClick={() => setEditBarcode({ productSizeId: s.id, barcode: '' })}
                              className="text-xs text-blue-500 hover:underline">+ Add barcode</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <div className="relative inline-block text-left">
                      <button
                        type="button"
                        onClick={() => setOpenMenuId(openMenuId === p.id ? null : p.id)}
                        className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                        aria-label={`Open actions for ${p.name}`}
                      >
                        ⋯
                      </button>
                      {openMenuId === p.id && (
                        <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                          <button
                            type="button"
                            onClick={() => { setEditProduct(p); setOpenMenuId(null) }}
                            className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Edit product details
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const firstSize = p.sizes?.[0]
                              if (!firstSize) {
                                window.alert('Add a size first before managing barcodes.')
                                return
                              }
                              setEditBarcode({ productSizeId: firstSize.id, barcode: firstSize.barcode ?? '' })
                              setOpenMenuId(null)
                            }}
                            className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Manage barcode
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteProduct(p.id)}
                            className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                          >
                            Delete product
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {products.length === 0 && (
            <div className="text-center py-12 text-gray-400">No products found</div>
          )}
        </div>
      )}

      {/* Barcode Edit Modal */}
      {editBarcode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[520px] max-w-[calc(100vw-2rem)] shadow-xl">
            <h3 className="font-bold text-gray-900 mb-4">Register Barcode</h3>
            <p className="text-sm text-gray-500 mb-3">Use the laptop camera or type the barcode for this product size.</p>
            <input
              value={editBarcode.barcode}
              onChange={e => setEditBarcode({ ...editBarcode, barcode: e.target.value })}
              placeholder="Barcode value"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-4"
              autoFocus
            />
            <WebcamBarcodeScanner
              compact
              title="Webcam barcode"
              helpText="Start camera and hold the bottle barcode in the guide. A beep confirms the scan."
              onScan={barcode => setEditBarcode(current => current ? { ...current, barcode } : current)}
              className="mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setEditBarcode(null)} className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={updateBarcode} disabled={!editBarcode.barcode} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}

      {showAdd && <AddProductModal onClose={() => { setShowAdd(false); load() }} />}
      {editProduct && <EditProductModal product={editProduct} onClose={() => { setEditProduct(null); load() }} />}
    </div>
  )
}

function AddProductModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ itemCode: '', name: '', category: 'WHISKY' })
  const [sizes, setSizes] = useState([{ sizeMl: 750, bottlesPerCase: 12, mrp: 0, sellingPrice: 0, barcode: '' }])
  const [scanSizeIndex, setScanSizeIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  function updateSize(index: number, updates: Partial<(typeof sizes)[number]>) {
    const nextSizes = [...sizes]
    nextSizes[index] = { ...nextSizes[index], ...updates }
    setSizes(nextSizes)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true)
    await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, sizes }),
    })
    setLoading(false); onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-auto py-8">
      <div className="bg-white rounded-2xl p-6 w-[760px] max-w-[calc(100vw-2rem)] shadow-xl">
        <h3 className="font-bold text-gray-900 text-lg mb-5">Add New Product</h3>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Item Code (KSBCL)</label>
              <input value={form.itemCode} onChange={e => setForm({...form, itemCode: e.target.value})} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                {['BRANDY','WHISKY','RUM','VODKA','GIN','WINE','PREMIX','BEER','BEVERAGE'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Sizes</label>
              <button type="button" onClick={() => setSizes([...sizes, { sizeMl: 375, bottlesPerCase: 24, mrp: 0, sellingPrice: 0, barcode: '' }])}
                className="text-xs text-blue-600 hover:underline">+ Add size</button>
            </div>
            <div className="space-y-2">
              {sizes.map((s, i) => (
                <div key={i} className="grid grid-cols-[80px_100px_95px_95px_minmax(0,1fr)_32px] gap-2 items-start">
                  <input type="number" value={s.sizeMl} onChange={e => updateSize(i, { sizeMl: +e.target.value })}
                    placeholder="ml" className="px-2 py-1.5 border border-gray-300 rounded text-sm outline-none" />
                  <input type="number" value={s.bottlesPerCase} onChange={e => updateSize(i, { bottlesPerCase: +e.target.value })}
                    placeholder="btls/case" className="px-2 py-1.5 border border-gray-300 rounded text-sm outline-none" />
                  <input type="number" value={s.mrp} onChange={e => updateSize(i, { mrp: +e.target.value })}
                    placeholder="MRP ₹" className="px-2 py-1.5 border border-gray-300 rounded text-sm outline-none" />
                  <input type="number" value={s.sellingPrice} onChange={e => updateSize(i, { sellingPrice: +e.target.value })}
                    placeholder="Sell ₹" className="px-2 py-1.5 border border-gray-300 rounded text-sm outline-none" />
                  <div className="flex min-w-0 gap-1">
                    <input value={s.barcode} onChange={e => updateSize(i, { barcode: e.target.value })}
                      placeholder="Barcode" className="min-w-0 flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-mono outline-none" />
                    <button type="button" onClick={() => setScanSizeIndex(scanSizeIndex === i ? null : i)}
                      className="rounded border border-gray-300 px-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
                      Camera
                    </button>
                  </div>
                  <button type="button" onClick={() => setSizes(sizes.filter((_,idx)=>idx!==i))} className="text-red-400 hover:text-red-600">×</button>
                  {scanSizeIndex === i && (
                    <div className="col-span-6">
                      <WebcamBarcodeScanner
                        compact
                        title={`Scan barcode for ${s.sizeMl}ml`}
                        helpText="Hold the bottle barcode in front of the laptop camera. A beep confirms the scan."
                        onScan={barcode => {
                          updateSize(i, { barcode })
                          setScanSizeIndex(null)
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditProductModal({ product, onClose }: { product: any; onClose: () => void }) {
  const [form, setForm] = useState({ itemCode: product.itemCode, name: product.name, category: product.category })
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch(`/api/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setLoading(false)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      window.alert(data.error ?? 'Unable to save product')
      return
    }

    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-auto py-8">
      <div className="bg-white rounded-2xl p-6 w-[640px] max-w-[calc(100vw-2rem)] shadow-xl">
        <h3 className="font-bold text-gray-900 text-lg mb-5">Edit Product</h3>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Item Code (KSBCL)</label>
              <input value={form.itemCode} onChange={e => setForm({ ...form, itemCode: e.target.value })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                {['BRANDY','WHISKY','RUM','VODKA','GIN','WINE','PREMIX','BEER','BEVERAGE'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
            Barcode and size changes can still be managed from the row actions and inline barcode controls.
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function categoryColor(cat: string) {
  const m: any = {
    BRANDY: 'bg-amber-100 text-amber-700',
    WHISKY: 'bg-yellow-100 text-yellow-700',
    RUM: 'bg-orange-100 text-orange-700',
    VODKA: 'bg-blue-100 text-blue-700',
    GIN: 'bg-teal-100 text-teal-700',
    WINE: 'bg-red-100 text-red-700',
    PREMIX: 'bg-pink-100 text-pink-700',
    BEER: 'bg-lime-100 text-lime-700',
    BEVERAGE: 'bg-gray-100 text-gray-600',
  }
  return m[cat] ?? 'bg-gray-100 text-gray-600'
}
