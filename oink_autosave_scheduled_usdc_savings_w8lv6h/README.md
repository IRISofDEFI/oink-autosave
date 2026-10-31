# Oink Autosave

A scheduled USDC savings app on Arc. Users create a recurring savings plan — pick an amount and how often to save — approve once, and the contract pulls USDC automatically on schedule. Saved funds accumulate in the contract and can be withdrawn any time.

Built with [Arc Studio](https://studio.arc.io)

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS
- **Web3:** wagmi v2, viem v2, ConnectKit
- **Smart Contract:** Solidity 0.8.28, OpenZeppelin 5.6.1, Foundry
- **Chain:** Arc Testnet (Chain ID: 5042002)
- **Token:** USDC at `0x3600000000000000000000000000000000000000`

## Development

### Prerequisites

- [Bun](https://bun.sh) v1+
- [Foundry](https://book.getfoundry.sh) (`forge`, `cast`)

### Install

```bash
bun install
```

### Run

```bash
bun run dev
```

### Build contracts

```bash
bun run contracts:build
```

### Test contracts

```bash
bun run contracts:test
```

## Environment Variables

None required to run the app locally. The contract address and USDC address are hardcoded to Arc Testnet in `src/contract.ts`.

## Deployed Contract

| Network     | Address |
|-------------|---------|
| Arc Testnet | `0x9f0ff95f332d4de79d89c266c52c46498e5fb04d` |

## Mainnet Deployment

The contract source is at `contracts/OinkAutosave.sol`. To deploy to Arc mainnet, compile with `forge build` and deploy yourself using `bun run deploy:self OinkAutosave '["0x3600000000000000000000000000000000000000"]'` (requires Circle API credentials). The USDC address is the same on both Arc Testnet and Arc mainnet.
