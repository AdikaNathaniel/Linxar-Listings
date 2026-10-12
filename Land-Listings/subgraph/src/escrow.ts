// =============================================================================
// Handlers for Escrow events
// =============================================================================
// Besides each Deal, we keep an Account record per address that mirrors the
// contract's `pendingWithdrawals`: money the escrow owes them. The handlers
// apply the same rules the contract does: completed → seller is owed,
// refunded → buyer is owed, withdrawal → back to zero.

import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  DealAccepted,
  DealCompleted,
  DealDisputed,
  DealOpened,
  DealRefunded,
  Withdrawal,
} from "../generated/Escrow/Escrow";
import { Account, Deal, Listing } from "../generated/schema";

// Deal statuses, matching the contract's DealStatus enum
const FUNDED = 0;
const ACCEPTED = 1;
const COMPLETED = 2;
const REFUNDED = 3;
const DISPUTED = 4;

// Loads an address's Account, or creates an empty one
function getAccount(address: Address): Account {
  const id = address.toHexString();
  let account = Account.load(id);
  if (account == null) {
    account = new Account(id);
    account.pendingWithdrawal = BigInt.zero();
    account.totalWithdrawn = BigInt.zero();
  }
  return account;
}

export function handleDealOpened(event: DealOpened): void {
  const deal = new Deal(event.params.dealId.toString());
  deal.dealId = event.params.dealId;
  deal.listing = event.params.listingId.toString();
  deal.listingId = event.params.listingId;
  // The event doesn't include the property id, but the listing record does
  const listing = Listing.load(event.params.listingId.toString());
  deal.propertyId = listing != null ? listing.propertyId : BigInt.zero();
  deal.buyer = event.params.buyer;
  deal.seller = event.params.seller;
  deal.kind = event.params.kind;
  deal.status = FUNDED;
  deal.amount = event.params.amount;
  deal.createdAt = event.block.timestamp;
  deal.acceptedAt = BigInt.zero();
  deal.save();
}

export function handleDealAccepted(event: DealAccepted): void {
  const deal = Deal.load(event.params.dealId.toString());
  if (deal == null) return;
  deal.status = ACCEPTED;
  deal.acceptedAt = event.block.timestamp; // starts the buyer's 7-day window
  deal.save();
}

export function handleDealCompleted(event: DealCompleted): void {
  const deal = Deal.load(event.params.dealId.toString());
  if (deal == null) return;
  deal.status = COMPLETED;
  deal.save();

  const seller = getAccount(Address.fromBytes(deal.seller));
  seller.pendingWithdrawal = seller.pendingWithdrawal.plus(deal.amount);
  seller.save();
}

export function handleDealRefunded(event: DealRefunded): void {
  const deal = Deal.load(event.params.dealId.toString());
  if (deal == null) return;
  deal.status = REFUNDED;
  deal.save();

  const buyer = getAccount(Address.fromBytes(deal.buyer));
  buyer.pendingWithdrawal = buyer.pendingWithdrawal.plus(deal.amount);
  buyer.save();
}

export function handleDealDisputed(event: DealDisputed): void {
  const deal = Deal.load(event.params.dealId.toString());
  if (deal == null) return;
  deal.status = DISPUTED;
  deal.disputedBy = event.params.raisedBy;
  deal.save();
}

export function handleWithdrawal(event: Withdrawal): void {
  const account = getAccount(event.params.account);
  account.pendingWithdrawal = BigInt.zero(); // the contract pays out everything owed
  account.totalWithdrawn = account.totalWithdrawn.plus(event.params.amount);
  account.save();
}
