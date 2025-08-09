'use client'

import { useState } from 'react'
import { DepositModal } from './index'

export default function DepositModalExample() {
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false)

  return (
    <div style={{ padding: '20px' }}>
      <h2>Deposit Modal Example</h2>
      <p>This example demonstrates the two-step deposit flow:</p>
      <ol>
        <li>First modal: Select payment method and token</li>
        <li>Second modal: Enter amount with percentage buttons (25%, 50%, 75%, Max)</li>
      </ol>
      
      <button
        onClick={() => setIsDepositModalOpen(true)}
        style={{
          background: '#4A9EFF',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '8px',
          border: 'none',
          cursor: 'pointer',
          fontSize: '16px',
          fontWeight: 500
        }}
      >
        Open Deposit Modal
      </button>

      <DepositModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
      />
    </div>
  )
} 