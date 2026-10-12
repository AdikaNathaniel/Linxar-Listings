// =============================================================================
// Handlers for PropertyRegistry events
// =============================================================================
// Written in AssemblyScript: TypeScript-like, compiled to WebAssembly and run
// by The Graph's indexers. Each function runs once per matching event, in the
// order the events happened on-chain, and updates our records (entities).
//
// The `generated/` imports are created by `npm run codegen` from the ABIs and
// the schema: typed event classes, and entity classes with .load() / .save().
// =============================================================================

import {
  PropertyRegistered,
  RegistrationApproved,
  RegistrationRejected,
  RegistrationRequested,
  Transfer,
} from "../generated/PropertyRegistry/PropertyRegistry";
import { Property, RegistrationRequest } from "../generated/schema";

// Request statuses, matching the contract's RequestStatus enum
const PENDING = 0;
const APPROVED = 1;
const REJECTED = 2;

// An owner submitted a registration request
export function handleRegistrationRequested(event: RegistrationRequested): void {
  // Every entity needs a unique string id: here, the request number
  const request = new RegistrationRequest(event.params.requestId.toString());
  request.requestId = event.params.requestId;
  request.applicant = event.params.applicant;
  request.deedHash = event.params.deedHash;
  request.metadataCID = event.params.metadataCID;
  request.status = PENDING;
  request.submittedAt = event.block.timestamp; // the block's time, as in Solidity
  request.save();
}

// A verifier approved it: link the request to the property NFT it became
export function handleRegistrationApproved(event: RegistrationApproved): void {
  const request = RegistrationRequest.load(event.params.requestId.toString());
  if (request == null) return;
  request.status = APPROVED;
  request.reviewedBy = event.params.verifier;
  request.property = event.params.propertyId.toString(); // a link to the Property entity
  request.save();
}

// A verifier rejected it. The reason exists ONLY in this event (not in
// contract storage), so saving it here is the only way to look it up quickly.
export function handleRegistrationRejected(event: RegistrationRejected): void {
  const request = RegistrationRequest.load(event.params.requestId.toString());
  if (request == null) return;
  request.status = REJECTED;
  request.reviewedBy = event.params.verifier;
  request.rejectionReason = event.params.reason;
  request.save();
}

// The property NFT was minted
export function handlePropertyRegistered(event: PropertyRegistered): void {
  const property = new Property(event.params.propertyId.toString());
  property.tokenId = event.params.propertyId;
  property.owner = event.params.owner;
  property.deedHash = event.params.deedHash;
  property.metadataCID = event.params.metadataCID;
  property.registeredAt = event.block.timestamp;
  property.save();
}

// The standard ERC-721 Transfer event: the NFT changed hands (e.g. after a
// sale through the escrow). Keep the owner up to date.
export function handleTransfer(event: Transfer): void {
  const property = Property.load(event.params.tokenId.toString());
  // When an NFT is minted, Transfer (from address 0) fires BEFORE
  // PropertyRegistered, so the Property doesn't exist yet. Nothing to do:
  // handlePropertyRegistered sets the first owner a moment later.
  if (property == null) return;
  property.owner = event.params.to;
  property.save();
}
