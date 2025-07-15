'use client'

import React from 'react'
import Link from 'next/link'

const demos = [
  {
    title: 'Review & Deploy (Initial)',
    description: 'The form review screen showing all market details before deployment starts',
    route: '/vamm-review-demo',
    color: '#3B82F6',
    icon: '📋'
  },
  {
    title: 'Deploying State',
    description: 'Loading state with progress steps and spinning animations during deployment',
    route: '/vamm-deploying-demo',
    color: '#F59E0B',
    icon: '⏳'
  },
  {
    title: 'Success State',
    description: 'The final success screen showing deployment details and contract addresses',
    route: '/vamm-success-demo',
    color: '#10B981',
    icon: '✅'
  },
  {
    title: 'Error State',
    description: 'Error screen when deployment fails with retry option',
    route: '/vamm-error-demo',
    color: '#EF4444',
    icon: '❌'
  }
]

export default function VAMMDemos() {
  return (
    <div style={{ backgroundColor: '#000000', minHeight: '100vh', padding: '40px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ marginBottom: '48px', textAlign: 'center' }}>
          <h1 style={{ color: '#ffffff', fontSize: '42px', fontWeight: '700', marginBottom: '16px' }}>
            vAMM Wizard Step 4 Demos
          </h1>
          <p style={{ color: '#9CA3AF', fontSize: '18px', lineHeight: '1.6', maxWidth: '600px', margin: '0 auto' }}>
            Explore all the different states of the final deployment step. Each demo shows a different phase 
            of the deployment process with realistic mock data.
          </p>
        </div>

        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
          gap: '24px',
          marginBottom: '48px'
        }}>
          {demos.map((demo, index) => (
            <Link 
              key={demo.route}
              href={demo.route}
              style={{ textDecoration: 'none' }}
            >
              <div style={{
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                padding: '24px',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                height: '100%',
                display: 'flex',
                flexDirection: 'column'
              }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
                  e.currentTarget.style.borderColor = demo.color
                  e.currentTarget.style.transform = 'translateY(-2px)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
                  e.currentTarget.style.transform = 'translateY(0)'
                }}
              >
                <div style={{ fontSize: '32px', marginBottom: '16px' }}>
                  {demo.icon}
                </div>
                <h3 style={{ 
                  color: '#ffffff', 
                  fontSize: '20px', 
                  fontWeight: '600', 
                  marginBottom: '8px',
                  lineHeight: '1.3'
                }}>
                  {demo.title}
                </h3>
                <p style={{ 
                  color: '#9CA3AF', 
                  fontSize: '14px', 
                  lineHeight: '1.5',
                  flex: '1'
                }}>
                  {demo.description}
                </p>
                <div style={{
                  marginTop: '16px',
                  padding: '8px 16px',
                  backgroundColor: demo.color,
                  color: '#ffffff',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '500',
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  View Demo
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div style={{ 
          backgroundColor: 'rgba(255, 255, 255, 0.05)', 
          borderRadius: '12px', 
          padding: '32px',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <h3 style={{ color: '#ffffff', fontSize: '24px', fontWeight: '600', marginBottom: '16px' }}>
            Development Notes
          </h3>
          <div style={{ color: '#9CA3AF', fontSize: '14px', lineHeight: '1.6' }}>
            <p style={{ marginBottom: '12px' }}>
              <strong>Purpose:</strong> These demo pages allow you to view and edit the Step 4 component 
              in isolation without going through the entire wizard flow.
            </p>
            <p style={{ marginBottom: '12px' }}>
              <strong>Components:</strong> All demos use the same <code>Step4ReviewDeploy</code> component 
              with different props to simulate various states.
            </p>
            <p style={{ marginBottom: '12px' }}>
              <strong>Mock Data:</strong> Each demo includes realistic mock data for wallet connections, 
              form data, and deployment results.
            </p>
            <p>
              <strong>Styling:</strong> Edit the component CSS in <code>VAMMWizard.module.css</code> 
              and see changes reflected across all demos.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
} 