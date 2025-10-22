import { FC, ReactNode } from 'react'

interface PortfolioLayoutProps {
  children: ReactNode
}

const PortfolioLayout: FC<PortfolioLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-[#0F0F0F]">
      {children}
    </div>
  )
}

export default PortfolioLayout
