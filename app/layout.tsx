import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "LEARNEX ERP",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Each page view carries its own Content-Security-Policy nonce (proxy.ts), and a nonce
  // can only be put on a page that is rendered per request, not one built in advance.
  await connection();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
