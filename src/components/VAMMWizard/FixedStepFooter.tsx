'use client'

import React from 'react'

interface FixedStepFooterProps {
  currentStep: number
  totalSteps: number
  canProceed: boolean
  onStepClick: (step: number) => void
  onNext: () => void
  onPrevious: () => void
  onSubmit: () => void
  isSubmitting?: boolean
  isLoading?: boolean
  walletConnected?: boolean
  walletAddress?: string | null
}

const FixedStepFooter: React.FC<FixedStepFooterProps> = ({
  currentStep,
  totalSteps,
  canProceed,
  onStepClick,
  onNext,
  onPrevious,
  onSubmit,
  isSubmitting = false,
  isLoading = false,
  walletConnected = false,
  walletAddress = null
}) => {
  const isLastStep = currentStep === totalSteps

  return (
    <div className="fixed bottom-[60px] left-1/2 transform -translate-x-1/2 z-30">
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 w-[480px] max-w-[calc(100vw-40px)]">
        
        {/* Wallet Status (only show on last step) */}
        {isLastStep && (
          <div className="mb-3 px-1">
            {walletConnected ? (
              <div className="flex items-center gap-2 text-xs text-green-600">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>Wallet Connected: {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-orange-600">
                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                <span>Wallet not connected - will prompt during deployment</span>
              </div>
            )}
          </div>
        )}

        {/* Step Progress */}
        <div className="flex items-center justify-center gap-2 mb-3">
          {[1, 2, 3, 4].map((step) => (
            <React.Fragment key={step}>
              <div
                className={`
                  w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium cursor-pointer transition-all duration-200
                  ${currentStep === step
                    ? 'bg-black text-white'
                    : currentStep > step
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                  }
                `}
                onClick={() => onStepClick(step)}
              >
                {step}
              </div>
              {step < 4 && (
                <div
                  className={`
                    w-4 h-0.5 transition-colors duration-200
                    ${currentStep > step ? 'bg-gray-800' : 'bg-gray-200'}
                  `}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step Labels */}
        <div className="flex justify-between text-xs text-gray-500 mb-3">
          <span className={currentStep === 1 ? 'text-black font-medium' : ''}>Market</span>
          <span className={currentStep === 2 ? 'text-black font-medium' : ''}>Oracle</span>
          <span className={currentStep === 3 ? 'text-black font-medium' : ''}>Images</span>
          <span className={currentStep === 4 ? 'text-black font-medium' : ''}>Deploy</span>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-between items-center">
          <button
            onClick={onPrevious}
            disabled={currentStep === 1}
            className={`
              px-3 py-1.5 rounded text-xs font-medium transition-all duration-200
              ${currentStep === 1
                ? 'text-gray-400 cursor-not-allowed'
                : 'text-gray-700 hover:text-black hover:bg-gray-50'
              }
            `}
          >
            Previous
          </button>

          <div className="flex gap-2">
            {isLastStep ? (
              <button
                onClick={onSubmit}
                disabled={!canProceed || isSubmitting}
                className={`
                  px-5 py-1.5 rounded text-xs font-medium transition-all duration-200
                  ${canProceed && !isSubmitting
                    ? 'bg-black text-white hover:bg-gray-800'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }
                `}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 border-2 border-gray-400 border-t-white rounded-full animate-spin" />
                    Deploying...
                  </span>
                ) : (
                  'Deploy vAMM'
                )}
              </button>
            ) : (
              <button
                onClick={onNext}
                disabled={!canProceed}
                className={`
                  px-5 py-1.5 rounded text-xs font-medium transition-all duration-200
                  ${canProceed
                    ? 'bg-black text-white hover:bg-gray-800'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }
                `}
              >
                Next Step
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default FixedStepFooter 