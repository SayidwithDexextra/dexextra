'use client'

import { useViewAs } from '@/contexts/ViewAsContext'

export type UseDataAddressResult = {
  dataAddress: string | null
  connectedAddress: string | null
  canMutate: boolean
  isViewingAs: boolean
}

/**
 * Read-path identity. Use `dataAddress` for positions / orders / vault reads.
 * Use `connectedAddress` + `canMutate` for every write.
 */
export function useDataAddress(): UseDataAddressResult {
  const { dataAddress, connectedAddress, canMutate, isViewingAs } = useViewAs()
  return { dataAddress, connectedAddress, canMutate, isViewingAs }
}

export default useDataAddress
