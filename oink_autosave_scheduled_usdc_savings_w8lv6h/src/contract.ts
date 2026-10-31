/**
 * OinkAutosave contract config — Arc Mainnet
 * Built with Arc Studio — https://studio.arc.io
 */
import artifact from '../contracts/out/OinkAutosave.sol/OinkAutosave.json'

export const OINK_AUTOSAVE = {
  address: '0x78e0Ff607db4890d9E4df2456CdEc25120142586' as const,
  abi: artifact.abi,
} as const

// Arc mainnet USDC (same address on testnet and mainnet)
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const

// Arc mainnet chain ID — exported under the same name so App.tsx needs no changes
export const ARC_TESTNET_CHAIN_ID = 5042
