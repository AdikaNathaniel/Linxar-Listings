// =============================================================================
// Everything the website needs to know to talk to AgentBadge
// =============================================================================
// Soulbound "Verified Agent" NFTs. Like the other contracts, both values come
// from contracts.generated.ts, rewritten by `npm run deploy:local`.

import { AgentBadge } from "./contracts.generated";

export const AGENT_BADGE_ADDRESS = AgentBadge.address;
export const agentBadgeAbi = AgentBadge.abi;
