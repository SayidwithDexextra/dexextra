/**
 * Formats a number as a currency string with USD formatting
 * @param value - The number to format
 * @returns Formatted currency string (e.g., "$1,234.56")
 */
export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)
}

/**
 * Formats a number as a percentage string
 * @param value - The number to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted percentage string (e.g., "12.34%")
 */
export const formatPercentage = (value: number, decimals: number = 2): string => {
  return `${value.toFixed(decimals)}%`
}

/**
 * Formats a large number with appropriate suffix (K, M, B, T)
 * @param value - The number to format
 * @returns Formatted number string (e.g., "1.2M")
 */
export const formatLargeNumber = (value: number): string => {
  const suffixes = ['', 'K', 'M', 'B', 'T']
  const suffixNum = Math.floor(Math.log10(Math.abs(value)) / 3)
  const shortValue = value / Math.pow(1000, suffixNum)
  
  return `${shortValue.toFixed(1)}${suffixes[suffixNum]}`
}
