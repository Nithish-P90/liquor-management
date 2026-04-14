import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'MV Liquor Management',
  description: 'Mahavishnu Wines — Inventory & Sales Management System',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-gray-50">
        <div className="bg-yellow-300 text-black text-center text-sm py-2">
          Render test: automated update — if you see this on the site, CI and deploy are functional.
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
