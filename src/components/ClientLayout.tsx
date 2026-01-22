'use client'

import { useState } from "react";
import { usePathname } from "next/navigation";
import Navbar from "./Navbar";
import Header from "./Header";
import { WalletProvider } from "@/hooks/useWallet";
import Footer from "./Footer";
import { DeploymentOverlayProvider } from "@/contexts/DeploymentOverlayContext";
import { SessionProvider } from "@/contexts/SessionContext";
import { EnableTradingPrompt } from "./EnableTrading";
import { ActiveMarketsProvider } from "@/contexts/ActiveMarketsContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

interface ClientLayoutProps {
  children: React.ReactNode;
}

export default function ClientLayout({ children }: ClientLayoutProps) {
  const [isNavbarOpen, setIsNavbarOpen] = useState(false);
  const pathname = usePathname();
  const isTokenPage = pathname?.startsWith('/token/');
  const collapsedNavbarWidth = isTokenPage ? 52 : 60;

  const handleNavbarOpenChange = (open: boolean) => {
    setIsNavbarOpen(open);
  };

  return (
    <WalletProvider>
      <SessionProvider>
        <DeploymentOverlayProvider>
          <ThemeProvider>
            <ActiveMarketsProvider>
              <div className="relative">
                <Header />
                
                <div className="flex">
                  <Navbar isOpen={isNavbarOpen} onOpenChange={handleNavbarOpenChange} />
                  <main 
                    className="flex-1"
                    style={{ 
                      marginLeft: `${collapsedNavbarWidth}px`, // Match collapsed navbar width
                      marginTop: '48px', // Account for fixed header
                      minHeight: 'calc(100vh - 96px)', // Subtract header and footer height
                      marginBottom: '48px', // Account for fixed footer
                      backgroundColor: '#1a1a1a' 
                    }}
                  >
                    <div style={{ backgroundColor: '#1a1a1a' }}>
                      {children}
                    </div>
                  </main>
                </div>
                {/* Global session-aware prompt for enabling trading */}
                <EnableTradingPrompt />
                <Footer />
              </div>
            </ActiveMarketsProvider>
          </ThemeProvider>
        </DeploymentOverlayProvider>
      </SessionProvider>
    </WalletProvider>
  );
} 