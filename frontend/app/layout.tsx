import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rasyid Signal Call — XAU/USD",
  description: "High-precision XAU/USD signal research dashboard"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
