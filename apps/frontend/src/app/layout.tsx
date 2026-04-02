import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WPT IoT',
  description: 'WPT Sistema IoT - Industria 4.0',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
