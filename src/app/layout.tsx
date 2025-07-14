import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import ClientLayout from "@/components/ClientLayout";

const inter = Inter({ subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({ 
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["300", "400", "500", "600", "700"]
});

export const metadata: Metadata = {
  title: "Dexetra - Futures Crypto Trading",
  description: "A modern crypto wallet dashboard built with Next.js",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${spaceGrotesk.variable} min-h-screen`} style={{ backgroundColor: '#1a1a1a' }}>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
