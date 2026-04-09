/**
 * Shared number formatting utilities for consistent display across the app
 */

/**
 * Format a number as currency (USD)
 * @param value The number to format
 * @param options Formatting options
 */
export function formatCurrency(
  value: number,
  options: {
    showSign?: boolean
    minimumDecimals?: number
    maximumDecimals?: number
    compact?: boolean
  } = {}
): string {
  const { 
    showSign = false, 
    minimumDecimals = 2, 
    maximumDecimals = 2,
    compact = false 
  } = options

  const absValue = Math.abs(value)
  const sign = showSign && value !== 0 ? (value >= 0 ? '+' : '-') : (value < 0 ? '-' : '')

  if (compact && absValue >= 1_000_000) {
    return `${sign}$${(absValue / 1_000_000).toFixed(1)}M`
  }
  if (compact && absValue >= 1_000) {
    return `${sign}$${(absValue / 1_000).toFixed(1)}K`
  }

  // Auto-adjust decimals for small values
  let decimals = maximumDecimals
  if (absValue > 0 && absValue < 0.01) {
    decimals = Math.max(6, maximumDecimals)
  } else if (absValue < 0.1) {
    decimals = Math.max(4, maximumDecimals)
  } else if (absValue < 1) {
    decimals = Math.max(3, maximumDecimals)
  }
  
  // Ensure minimum decimals
  decimals = Math.max(decimals, minimumDecimals)

  // Format with thousand separators
  const formatted = absValue.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return `${sign}$${formatted}`
}

/**
 * Format a number with thousands separators
 */
export function formatNumber(
  value: number,
  options: {
    decimals?: number
    showSign?: boolean
    compact?: boolean
  } = {}
): string {
  const { decimals = 0, showSign = false, compact = false } = options
  
  const absValue = Math.abs(value)
  const sign = showSign && value !== 0 ? (value >= 0 ? '+' : '-') : (value < 0 ? '-' : '')

  if (compact && absValue >= 1_000_000) {
    return `${sign}${(absValue / 1_000_000).toFixed(1)}M`
  }
  if (compact && absValue >= 1_000) {
    return `${sign}${(absValue / 1_000).toFixed(1)}K`
  }

  const formatted = absValue.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return `${sign}${formatted}`
}

/**
 * Format a percentage
 */
export function formatPercent(
  value: number,
  options: {
    decimals?: number
    showSign?: boolean
  } = {}
): string {
  const { decimals = 1, showSign = false } = options
  const sign = showSign && value !== 0 ? (value >= 0 ? '+' : '') : ''
  return `${sign}${value.toFixed(decimals)}%`
}

/**
 * Format quantity/amount with appropriate decimals
 */
export function formatQuantity(value: number, decimals: number = 4): string {
  const absValue = Math.abs(value)
  
  // Auto-adjust for very small or very large values
  if (absValue === 0) return '0'
  if (absValue >= 1_000_000) return formatNumber(value, { decimals: 0, compact: true })
  if (absValue >= 1_000) return formatNumber(value, { decimals: 2 })
  if (absValue >= 1) return value.toFixed(Math.min(decimals, 4))
  if (absValue >= 0.0001) return value.toFixed(Math.min(decimals, 6))
  
  return value.toExponential(2)
}

/**
 * Format price with appropriate precision
 */
export function formatPrice(value: number): string {
  const absValue = Math.abs(value)
  
  if (absValue >= 1000) return `$${absValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (absValue >= 1) return `$${absValue.toFixed(2)}`
  if (absValue >= 0.01) return `$${absValue.toFixed(4)}`
  if (absValue >= 0.0001) return `$${absValue.toFixed(6)}`
  
  return `$${absValue.toExponential(2)}`
}
