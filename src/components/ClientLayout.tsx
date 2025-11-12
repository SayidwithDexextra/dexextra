'use client'

import { useState } from "react";
import Navbar from "./Navbar";
import Header from "./Header";
import { WalletProvider } from "@/hooks/useWallet";
import Footer from "./Footer";
import { DeploymentOverlayProvider } from "@/contexts/DeploymentOverlayContext";

interface ClientLayoutProps {
  children: React.ReactNode;
}

export default function ClientLayout({ children }: ClientLayoutProps) {
  const [isNavbarOpen, setIsNavbarOpen] = useState(false);

  const handleNavbarOpenChange = (open: boolean) => {
    setIsNavbarOpen(open);
  };

  return (
    <WalletProvider>
      <DeploymentOverlayProvider>
        <div className="relative">
          <Header />
          
          <div className="flex">
            <Navbar isOpen={isNavbarOpen} onOpenChange={handleNavbarOpenChange} />
            <main 
              className="flex-1"
              style={{ 
                marginLeft: '60px', // Fixed margin for collapsed navbar only
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
          <Footer />
        </div>
      </DeploymentOverlayProvider>
    </WalletProvider>
  );
} 