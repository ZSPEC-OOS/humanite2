import type { Metadata } from 'next'
import { Inter, Playfair_Display, Lora } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair' })
const lora = Lora({ subsets: ['latin'], variable: '--font-lora' })

export const metadata: Metadata = {
  title: 'Humanite — AI to Human Text Converter',
  description: 'Transform AI-generated text into natural, undetectable human prose.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable} ${lora.variable}`}>
      <body className="font-sans antialiased bg-white text-gray-900">{children}</body>
    </html>
  )
}
