'use client'

import { useCallback, useEffect, useState } from "react";
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
import { OnchainOrdersProvider } from "@/contexts/OnchainOrdersContextV2";
import PortfolioSidebar from "@/components/PortfolioV2/PortfolioSidebar";
import { PortfolioSnapshotProvider } from "@/contexts/PortfolioSnapshotContext";
import ExternalAppOpenGuard from "@/components/ExternalAppOpenGuard";

interface ClientLayoutProps {
  children: React.ReactNode;
}

export default function ClientLayout({ children }: ClientLayoutProps) {
  const [isNavbarOpen, setIsNavbarOpen] = useState(false);
  const [isPortfolioSidebarOpen, setIsPortfolioSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();
  const isTokenPage = pathname?.startsWith('/token/');
  const collapsedNavbarWidth = isTokenPage ? 52 : 60;

  const handleNavbarOpenChange = useCallback((open: boolean) => {
    setIsNavbarOpen(open);
  }, []);

  // Global listener so header (and other components) can open the portfolio sidebar.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateMobileState = () => setIsMobile(mediaQuery.matches);
    updateMobileState();
    mediaQuery.addEventListener('change', updateMobileState);
    return () => mediaQuery.removeEventListener('change', updateMobileState);
  }, []);

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
        <OnchainOrdersProvider>
        <DeploymentOverlayProvider>
          <ThemeProvider>
            <ActiveMarketsProvider>
              <WalkthroughProvider>
                <PortfolioSnapshotProvider>
                  <ExternalAppOpenGuard />
                  <div className="relative">
                    <Header />
                    <PortfolioSidebar isOpen={isPortfolioSidebarOpen} onClose={() => setIsPortfolioSidebarOpen(false)} />
                  
                    <div className="flex">
                      <Navbar isOpen={isNavbarOpen} onOpenChange={handleNavbarOpenChange} />
                      <div 
                        className="flex-1"
                        style={{
                          // Mobile: slide content when menu opens (encapsulates screen in sliding animation)
                          transform: isMobile && isNavbarOpen ? 'translateX(85vw)' : 'translateX(0)',
                          transition: 'transform 300ms ease-in-out',
                          minWidth: 0,
                        }}
                      >
                        <main 
                          className="flex-1"
                          style={{ 
                            marginLeft: isMobile ? '0px' : `${collapsedNavbarWidth}px`, // Sidebar does not reserve width on mobile
                            marginTop: isMobile ? '56px' : '48px', // Mobile header is 56px
                            minHeight: isMobile ? 'calc(100vh - 56px)' : 'calc(100vh - 96px)', // Desktop still accounts for footer
                            marginBottom: isMobile ? '0px' : '48px', // Footer reserved only on desktop
                            backgroundColor: '#1a1a1a',
                            minWidth: 0,
                            overflow: 'hidden',
                          }}
                        >
                          <div style={{ backgroundColor: '#1a1a1a', width: '100%', overflow: 'hidden' }}>
                            {children}
                          </div>
                        </main>
                      </div>
                    </div>
                    {/* Global session-aware prompt for enabling trading */}
                    <EnableTradingPrompt />
                    {!isMobile && <Footer />}
                  </div>
                </PortfolioSnapshotProvider>
              </WalkthroughProvider>
            </ActiveMarketsProvider>
          </ThemeProvider>
        </DeploymentOverlayProvider>
        </OnchainOrdersProvider>
      </SessionProvider>
    </WalletProvider>
  );
} 