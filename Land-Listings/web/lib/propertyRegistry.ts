// =============================================================================
// Everything the website needs to know to talk to PropertyRegistry
// =============================================================================
// Like listingBoard.ts, both values come from contracts.generated.ts, which
// `npm run deploy:local` rewrites after every deployment.

import { PropertyRegistry } from "./contracts.generated";

// WHERE the registry lives (deployed first, see ignition/modules/LinXar.ts)
export const PROPERTY_REGISTRY_ADDRESS = PropertyRegistry.address;

// WHAT it can do: our own functions (registerProperty, getProperty…) PLUS
// every standard ERC-721 function inherited from OpenZeppelin (ownerOf,
// balanceOf, transferFrom, approve…). They're all in the ABI.
export const propertyRegistryAbi = PropertyRegistry.abi;
