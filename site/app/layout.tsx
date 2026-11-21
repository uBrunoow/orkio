import type { Metadata, Viewport } from 'next'
import { getDictionary } from '@/i18n'
import { inter, jost, mono } from './fonts'
import './globals.css'

const t = getDictionary()

export const metadata: Metadata = {
  title: { default: t.meta.title, template: '%s · Orkio' },
  description: t.meta.description,
  ...(process.env['SITE_URL'] ? { metadataBase: new URL(process.env['SITE_URL']) } : {}),
  openGraph: {
    title: t.meta.title,
    description: t.meta.description,
    locale: 'pt_BR',
    type: 'website'
  },
  robots: { index: true, follow: true }
}

export const viewport: Viewport = {
  themeColor: '#0a0a0b',
  colorScheme: 'dark'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={t.locale} className={`${jost.variable} ${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
