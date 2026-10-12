// =============================================================================
// Handlers for AgentBadge events (soulbound Verified Agent badges)
// =============================================================================

import { AgentRevoked, AgentVerified } from "../generated/AgentBadge/AgentBadge";
import { Agent } from "../generated/schema";

export function handleAgentVerified(event: AgentVerified): void {
  // The id is the agent's address, the same id Listing.agent points to.
  // An agent can be verified, revoked, then verified again, so reuse the record.
  const id = event.params.agent.toHexString();
  let agent = Agent.load(id);
  if (agent == null) agent = new Agent(id);
  agent.verified = true;
  agent.profileCID = event.params.profileCID;
  agent.verifiedBy = event.params.verifier;
  agent.verifiedAt = event.block.timestamp;
  agent.revokedAt = null;
  agent.save();
}

export function handleAgentRevoked(event: AgentRevoked): void {
  const agent = Agent.load(event.params.agent.toHexString());
  if (agent == null) return;
  agent.verified = false;
  agent.revokedAt = event.block.timestamp;
  agent.save();
}
