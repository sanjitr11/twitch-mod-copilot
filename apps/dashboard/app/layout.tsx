import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Twitch Moderation Co-Pilot',
  description: 'Human-in-the-loop chat moderation dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
