import type { Metadata } from "next"
import { Source_Sans_3 } from "next/font/google"

import "@/app/globals.css"

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  weight: ["400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: "Mahavishnu Liquor Manager",
  description: "Web-first liquor outlet operations and inventory management",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>): JSX.Element {
  return (
    <html lang="en">
      <body className={`${sourceSans.variable} bg-slate-50 text-slate-900 antialiased`}>{children}</body>
    </html>
  )
}
