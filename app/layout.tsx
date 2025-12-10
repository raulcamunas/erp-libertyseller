import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ 
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-inter",
})

export const metadata: Metadata = {
  title: "Liberty Seller Hub - ERP",
  description: "ERP interno para Liberty Seller",
  icons: {
    icon: '/logos/icon.png',
    apple: '/logos/icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
