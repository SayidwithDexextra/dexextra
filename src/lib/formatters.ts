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

/**
 * Format size with compact display - shows < prefix when truncated after 3 significant digits
 * Very small non-zero values show "< 0.001" instead of "0"
 * Example: 0.00001234 -> "< 0.001", 0.0234 -> "0.023", 1.234567 -> "1.234"
 */
export function formatCompactSize(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (!Number.isFinite(num)) return '0'
  if (num === 0) return '0'
  
  const absValue = Math.abs(num)
  const sign = num < 0 ? '-' : ''
  
  // Very small values: show "< 0.001" instead of rounding to 0
  if (absValue > 0 && absValue < 0.001) {
    return `< ${sign}0.001`
  }
  
  if (absValue >= 1000) {
    return `${sign}${absValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  }
  
  if (absValue >= 100) {
    return `${sign}${absValue.toFixed(1)}`
  }
  
  if (absValue >= 10) {
    return `${sign}${absValue.toFixed(2)}`
  }
  
  if (absValue >= 1) {
    return `${sign}${absValue.toFixed(3)}`
  }
  
  // Values between 0.001 and 1: show 3 significant digits
  if (absValue >= 0.1) {
    return `${sign}${absValue.toFixed(3)}`
  }
  
  if (absValue >= 0.01) {
    return `${sign}${absValue.toFixed(3)}`
  }
  
  // 0.001 to 0.01 range
  return `${sign}${absValue.toFixed(3)}`
}
