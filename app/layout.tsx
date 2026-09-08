import Link from "next/link";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "riftbound-db",
  description: "Who owns which Riftbound cards, and who is holding whose.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <nav className="border-b border-neutral-900 px-6 py-3 text-sm">
          <Link href="/" className="font-medium">
            riftbound-db
          </Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
