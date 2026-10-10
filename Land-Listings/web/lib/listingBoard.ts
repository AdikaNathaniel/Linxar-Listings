// =============================================================================
// Everything the website needs to know to talk to ListingBoard
// =============================================================================
// Both values come from contracts.generated.ts, which is written automatically
// by `npm run deploy:local` (in the contracts folder) after every deployment.
// You never need to copy an address or ABI by hand again.

import { ListingBoard } from "./contracts.generated";

// WHERE the contract lives: the address Hardhat Ignition deployed it to.
// Every contract on a blockchain has a unique address like this.
export const LISTING_BOARD_ADDRESS = ListingBoard.address;

// WHAT the contract can do: its ABI (Application Binary Interface).
// The blockchain only stores bytecode, which is just numbers. The ABI is the
// "menu" that tells viem each function's name, its inputs and outputs, and
// whether it changes state. viem uses it to turn
// `createListing("House", "Accra", 2 ETH)` into the hex data the contract
// understands, and to decode the answers back into JavaScript values.
// It's copied from the exact build that was deployed, so it always matches
// the contract, even after you add new functions or events.
export const listingBoardAbi = ListingBoard.abi;
