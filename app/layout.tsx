import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Modular · Engineering QA',
  description: 'Private engineering document review with revision-aware evidence and recorded decisions.',
  icons: { icon: '/favicon.svg' },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
