"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"

import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"

type ProductSize = {
  id: number
  sizeMl: number
  bottlesPerCase: number
  mrp: string
  sellingPrice: string
  barcode: string | null
}

type Product = {
  id: number
  itemCode: string
  name: string
  category: string
  sizes: ProductSize[]
}

export default function ProductsPage(): JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [uploading, setUploading] = useState(false)

  const fetchProducts = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/products?limit=500${search ? `&search=${encodeURIComponent(search)}` : ""}`)
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        setError(body.error ?? "Failed to load products")
        return
      }
      const body = (await res.json()) as Product[]
      setProducts(body)
    } catch {
      setError("Failed to load products")
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    void fetchProducts()
  }, [fetchProducts])

  async function handleUpload(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem("file") as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) {
      setError("Select an Excel file first")
      return
    }

    setUploading(true)
    setError(null)

    const data = new FormData()
    data.append("file", file)

    const res = await fetch("/api/admin/products/import", {
      method: "POST",
      body: data,
    })

    if (!res.ok) {
      const body = (await res.json()) as { error?: string }
      setError(body.error ?? "Import failed")
      setUploading(false)
      return
    }

    setUploading(false)
    await fetchProducts()
    form.reset()
  }

  const productCount = useMemo(() => products.length, [products])

  return (
    <PageShell title="Products" subtitle="Import your existing workbook, then manually replace KSBCL pending item codes.">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or item code" />
          <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
            {loading ? "Loading..." : `${productCount} products`}
          </div>
        </div>

        <form onSubmit={handleUpload} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-700 bg-slate-950 p-3">
          <input name="file" type="file" accept=".xlsx,.xls" className="text-sm text-slate-300" />
          <Button type="submit" disabled={uploading}>
            {uploading ? "Importing..." : "Import Products from Excel"}
          </Button>
        </form>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <div className="overflow-x-auto rounded-md border border-slate-700">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-950 text-left text-slate-300">
              <tr>
                <th className="px-3 py-2">Item Code</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Sizes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900">
              {products.map((product) => (
                <tr key={product.id}>
                  <td className="px-3 py-2 font-mono text-xs text-amber-300">{product.itemCode}</td>
                  <td className="px-3 py-2 text-slate-100">{product.name}</td>
                  <td className="px-3 py-2 text-slate-300">{product.category}</td>
                  <td className="px-3 py-2 text-slate-300">
                    {product.sizes
                      .map((size) => `${size.sizeMl}ml (MRP ${size.mrp}, Sell ${size.sellingPrice})`)
                      .join(", ")}
                  </td>
                </tr>
              ))}
              {!loading && products.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-slate-400" colSpan={4}>
                    No products found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  )
}
