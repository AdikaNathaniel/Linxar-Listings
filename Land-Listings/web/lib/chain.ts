// =============================================================================
// WHICH blockchain the website talks to
// =============================================================================
// Decided by contracts.generated.ts, i.e. by whichever deployment you last
// exported (`npm run use:local` or `npm run use:sepolia` in contracts/).
// Everything else in the website imports `chain` and `publicClient` from
// here, so switching networks needs no code changes.

import { createPublicClient, http, type Chain } from "viem";
import { hardhat, sepolia } from "viem/chains";
import { CHAIN_ID, DEPLOY_BLOCK, NETWORK } from "./contracts.generated";

// (`: number` because the generated file holds ONE fixed id, e.g. 31337,
//  and TypeScript would otherwise say the comparison can never be true)
const exportedChainId: number = CHAIN_ID;
export const chain: Chain = exportedChainId === sepolia.id ? sepolia : hardhat;
export const isLocal = chain.id === hardhat.id;
export { DEPLOY_BLOCK, NETWORK };

// The node we READ from. Locally: your Hardhat node at 127.0.0.1:8545.
// On Sepolia: your Alchemy URL from .env.local (NEXT_PUBLIC_SEPOLIA_RPC_URL),
// or viem's default public Sepolia node if it isn't set.
// ⚠️ NEXT_PUBLIC_ values are visible to every visitor. That's acceptable for
// a free testnet key; in Alchemy's dashboard you can restrict it to your
// site's domain.
const rpcUrl = isLocal ? undefined : process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || undefined;

// -----------------------------------------------------------------------------
// The PUBLIC client is for READING from the blockchain. No wallet needed,
// because reading is free and anyone can do it. No signature, no gas.
// -----------------------------------------------------------------------------
export const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

// How often to check for new events. Locally, blocks are instant. On Sepolia
// a new block comes every ~12 seconds, and each check costs RPC credits, so
// there's no point checking every second.
export const POLL_MS = isLocal ? 1_000 : 4_000;

// Links to the public block explorer (only Sepolia has one)
const explorer = chain.blockExplorers?.default.url;
export const explorerTxUrl = (hash: string) => (explorer ? `${explorer}/tx/${hash}` : null);
export const explorerAddressUrl = (address: string) => (explorer ? `${explorer}/address/${address}` : null);
