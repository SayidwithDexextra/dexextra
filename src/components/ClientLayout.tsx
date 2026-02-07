'use client'

import { useEffect, useState } from "react";
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
import { WalkthroughProvider } from "@/contexts/WalkthroughContext";
import PortfolioSidebar from "@/components/PortfolioV2/PortfolioSidebar";

interface ClientLayoutProps {
  children: React.ReactNode;
}

export default function ClientLayout({ children }: ClientLayoutProps) {
  const [isNavbarOpen, setIsNavbarOpen] = useState(false);
  const [isPortfolioSidebarOpen, setIsPortfolioSidebarOpen] = useState(false);
  const pathname = usePathname();
  const isTokenPage = pathname?.startsWith('/token/');
  const collapsedNavbarWidth = isTokenPage ? 52 : 60;

  const handleNavbarOpenChange = (open: boolean) => {
    setIsNavbarOpen(open);
  };

  // Global listener so header (and other components) can open the portfolio sidebar.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onOpen = () => setIsPortfolioSidebarOpen(true);
    const onClose = () => setIsPortfolioSidebarOpen(false);

    window.addEventListener('portfolioSidebar:open', onOpen as EventListener);
    window.addEventListener('portfolioSidebar:close', onClose as EventListener);
    return () => {
      window.removeEventListener('portfolioSidebar:open', onOpen as EventListener);
      window.removeEventListener('portfolioSidebar:close', onClose as EventListener);
    };
  }, []);

  return (
    <WalletProvider>
      <SessionProvider>
        <DeploymentOverlayProvider>
          <ThemeProvider>
            <ActiveMarketsProvider>
              <WalkthroughProvider>
                <div className="relative">
                  <Header />
                  <PortfolioSidebar isOpen={isPortfolioSidebarOpen} onClose={() => setIsPortfolioSidebarOpen(false)} />
                  
                  <div className="flex">
                    <Navbar isOpen={isNavbarOpen} onOpenChange={handleNavbarOpenChange} />
                    <main 
                      className="flex-1"
                      style={{ 
                        marginLeft: `${collapsedNavbarWidth}px`, // Match collapsed navbar width
                        marginTop: '48px', // Account for fixed header
                        minHeight: 'calc(100vh - 96px)', // Subtract header and footer height
                        marginBottom: '48px', // Account for fixed footer
                        backgroundColor: '#1a1a1a',
                        minWidth: 0, // Prevent flex child from overflowing
                        overflow: 'hidden', // Contain any overflowing content
                      }}
                    >
                      <div style={{ backgroundColor: '#1a1a1a', width: '100%', overflow: 'hidden' }}>
                        {children}
                      </div>
                    </main>
                  </div>
                  {/* Global session-aware prompt for enabling trading */}
                  <EnableTradingPrompt />
                  <Footer />
                </div>
              </WalkthroughProvider>
            </ActiveMarketsProvider>
          </ThemeProvider>
        </DeploymentOverlayProvider>
      </SessionProvider>
    </WalletProvider>
  );
} 