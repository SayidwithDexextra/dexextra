import { ethers } from 'ethers'

/**
 * Merkle helpers for session relayer sets.
 *
 * On-chain leaf in GlobalSessionRegistry is:
 *   keccak256(abi.encodePacked(relayerAddress))
 *
 * OpenZeppelin MerkleProof uses commutative hashing (sorted pairs).
 * We mirror that here so roots and proofs match OZ verification.
 */

export function merkleLeafForRelayer(address: string): string {
  const a = ethers.getAddress(address)
  return ethers.keccak256(ethers.solidityPacked(['address'], [a]))
}

function hashPair(a: string, b: string): string {
  // commutativeKeccak256: hash(min || max)
  const aa = a.toLowerCase()
  const bb = b.toLowerCase()
  const [left, right] = aa <= bb ? [a, b] : [b, a]
  return ethers.keccak256(ethers.concat([left as any, right as any]) as any)
}

export function computeRelayerSetRoot(relayerAddresses: string[]): string {
  const leaves = relayerAddresses.map(merkleLeafForRelayer)
  if (leaves.length === 0) return ethers.ZeroHash
  // Sort leaves for determinism
  let level = [...leaves].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()))
  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = level[i + 1] ?? level[i] // duplicate last if odd
      next.push(hashPair(left, right))
    }
    level = next
  }
  return level[0]
}

export function computeRelayerProof(relayerAddresses: string[], relayerAddress: string): string[] {
  const leaves = relayerAddresses.map(merkleLeafForRelayer)
  const targetLeaf = merkleLeafForRelayer(relayerAddress)
  if (leaves.length === 0) return []

  // Sort leaves (must match root builder)
  let level = [...leaves].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()))
  let idx = level.findIndex((x) => x.toLowerCase() === targetLeaf.toLowerCase())
  if (idx < 0) return []

  const proof: string[] = []
  while (level.length > 1) {
    const isRight = idx % 2 === 1
    const pairIdx = isRight ? idx - 1 : idx + 1
    const sibling = level[pairIdx] ?? level[idx] // duplicate self if odd
    proof.push(sibling)

    // Build next level
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = level[i + 1] ?? level[i]
      next.push(hashPair(left, right))
    }
    level = next
    idx = Math.floor(idx / 2)
  }

  return proof
}





