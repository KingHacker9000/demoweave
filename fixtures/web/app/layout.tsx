import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Northstar Projects',
  description: 'A deterministic project-management fixture for DemoWeave.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
