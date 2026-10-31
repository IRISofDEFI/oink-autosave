# Oink Autosave

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Oink Autosave is a scheduled USDC savings app on Arc. Users create savings plans with an amount per cycle and a cycle length in seconds. They approve the contract once via ERC-20 approve. When a save is due, anyone can call executeSave() to pull the USDC from the plan owner into their saved balance. Users can withdraw any time, pause, resume, or cancel plans.

## Deployed Contracts

| Contract      | Network      | Address                                      | Explorer |
|--------------|--------------|----------------------------------------------|---------|
| OinkAutosave | Arc Testnet  | 0x9f0ff95f332d4de79d89c266c52c46498e5fb04d   | https://explorer.testnet.arc.io/address/0x9f0ff95f332d4de79d89c266c52c46498e5fb04d |
| OinkAutosave | Arc Mainnet  | 0x78e0Ff607db4890d9E4df2456CdEc25120142586   | https://explorer.arc.io/address/0x78e0Ff607db4890d9E4df2456CdEc25120142586 |

**Frontend currently points to: Arc Mainnet (chain ID 5042)**

Constructor arg: usdcToken = 0x3600000000000000000000000000000000000000 (Arc Testnet + Mainnet USDC)

## Key Design Decisions

- executeSave() is permissionless — the app or any scheduler can call it, but it always pulls from the plan.owner who approved.
- Mainnet deploy: user must deploy themselves (see AGENTS.md + contract at contracts/OinkAutosave.sol). Same USDC address (0x3600000000000000000000000000000000000000) works on Arc mainnet.
- No admin roles — fully permissionless except per-plan owner checks.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
