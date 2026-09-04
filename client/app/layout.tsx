import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import ThemeScript from '@/components/ThemeScript';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'NoteCraft — collaborative CS notes',
  description:
    'Markdown notes for computer science students, with runnable code blocks, live collaboration, and shared reading.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The inline script adds `dark` before hydration, which React would
      // otherwise flag as a server/client mismatch on <html>.
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
