import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Zeko',
  description: 'Every screen and state of your product on one light table, with agents that redesign them.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`dark ${geist.variable} ${geistMono.variable}`}>
      <body>
        <TooltipProvider delay={400}>{children}</TooltipProvider>
      </body>
    </html>
  )
}
