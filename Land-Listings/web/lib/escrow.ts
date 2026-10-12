// =============================================================================
// Everything the website needs to know to talk to Escrow
// =============================================================================
// Like the other contracts, both values come from contracts.generated.ts,
// which `npm run deploy:local` rewrites after every deployment.

import type { Address } from "viem";
import { Escrow } from "./contracts.generated";

export const ESCROW_ADDRESS = Escrow.address;
export const escrowAbi = Escrow.abi;

// One deal, as getDeal() returns it (see the Deal struct in Escrow.sol)
export type Deal = {
  id: bigint;
  listingId: bigint;
  propertyId: bigint;
  buyer: Address;
  kind: number; // DealKind
  status: number; // DealStatus
  seller: Address;
  createdAt: bigint;
  acceptedAt: bigint;
  amount: bigint; // wei locked in the escrow
};

// Enum labels, in the SAME ORDER as the contract
export const DEAL_KINDS = ["Purchase", "Rental deposit"] as const; // DealKind
export const DEAL_STATUSES = ["Waiting for seller", "Accepted", "Completed", "Refunded", "Disputed"] as const;
export const DealKind = { Purchase: 0, RentalDeposit: 1 } as const;
export const DealStatus = { Funded: 0, Accepted: 1, Completed: 2, Refunded: 3, Disputed: 4 } as const;

// Every button a deal can have. Each one is one escrow function.
export type DealAction = "cancel" | "reject" | "accept" | "confirm" | "finalize" | "dispute" | "refund" | "release";
