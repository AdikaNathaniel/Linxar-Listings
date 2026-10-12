// =============================================================================
// Reading LinXar's data from THE GRAPH (Milestone 9, Sepolia only)
// =============================================================================
// Instead of asking the contracts for each listing / deal / property one by
// one (hundreds of RPC calls), we send ONE GraphQL query to our subgraph,
// which has already indexed every event our contracts ever emitted.
//
// The subgraph returns numbers as STRINGS (BigInt can be huge) and addresses
// in lower case, so each function below converts its results into the same
// shapes the rest of the website already uses.

import type { Address, Hex } from "viem";
import type { Listing } from "../components/ListingCard";
import type { OwnedProperty } from "../components/MyProperties";
import type { RegistrationRequest } from "../components/MyRequests";
import type { Deal } from "./escrow";

// The "Queries (HTTP)" URL printed by `npm run deploy` in subgraph/.
// Not a secret: anyone can query a subgraph. Override in .env.local if needed.
export const SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_URL || "https://api.studio.thegraph.com/query/1763133/lin-xar/v0.0.1";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

// -----------------------------------------------------------------------------
// One GraphQL request: POST the query (and its variables), get JSON back
// -----------------------------------------------------------------------------
async function query<T>(gql: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`The Graph: ${json.errors[0].message}`);
  if (!json.data) throw new Error(`The Graph: empty response (HTTP ${res.status})`);
  return json.data;
}

// -----------------------------------------------------------------------------
// EVENTUAL CONSISTENCY: a new transaction is on-chain immediately, but The
// Graph needs a few seconds to process its block. Before re-reading after a
// transaction, wait until the subgraph has reached that block. `_meta` is a
// built-in field: it tells you the latest block the subgraph has indexed.
// -----------------------------------------------------------------------------
export async function waitForIndexing(blockNumber: bigint, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { _meta } = await query<{ _meta: { block: { number: number } } }>(`{ _meta { block { number } } }`);
    if (BigInt(_meta.block.number) >= blockNumber) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

// -----------------------------------------------------------------------------
// LISTINGS (newest first), plus which listers are verified agents
// -----------------------------------------------------------------------------
type ListingRow = {
  listingId: string;
  propertyId: string;
  owner: Address;
  listingType: number;
  category: number;
  status: number;
  pricePeriod: number;
  sizeSqm: string;
  priceWei: string;
  createdAt: string;
  updatedAt: string;
  region: string;
  metadataCID: string;
};

export async function graphListings(): Promise<Listing[]> {
  const { listings } = await query<{ listings: ListingRow[] }>(`{
    listings(first: 1000, orderBy: listingId, orderDirection: desc) {
      listingId propertyId owner listingType category status pricePeriod
      sizeSqm priceWei createdAt updatedAt region metadataCID
    }
  }`);
  return listings.map((l) => ({
    id: BigInt(l.listingId),
    propertyId: BigInt(l.propertyId),
    owner: l.owner,
    listingType: l.listingType,
    category: l.category,
    status: l.status,
    pricePeriod: l.pricePeriod,
    sizeSqm: Number(l.sizeSqm),
    priceWei: BigInt(l.priceWei),
    createdAt: BigInt(l.createdAt),
    updatedAt: BigInt(l.updatedAt),
    region: l.region,
    metadataCID: l.metadataCID,
  }));
}

// Which of these addresses currently hold a Verified Agent badge?
export async function graphVerifiedAgents(addresses: Address[]): Promise<Set<string>> {
  const ids = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const { agents } = await query<{ agents: { id: string }[] }>(
    `query ($ids: [ID!]) { agents(where: { id_in: $ids, verified: true }) { id } }`,
    { ids },
  );
  return new Set(agents.map((a) => a.id));
}

// -----------------------------------------------------------------------------
// MY PROPERTIES: the NFTs this address owns right now
// -----------------------------------------------------------------------------
export async function graphOwnedProperties(owner: Address): Promise<OwnedProperty[]> {
  const { properties } = await query<{
    properties: { tokenId: string; deedHash: Hex; metadataCID: string; registeredAt: string }[];
  }>(
    `query ($owner: Bytes!) {
      properties(where: { owner: $owner }, orderBy: tokenId) { tokenId deedHash metadataCID registeredAt }
    }`,
    { owner: owner.toLowerCase() },
  );
  return properties.map((p) => ({
    id: BigInt(p.tokenId),
    deedHash: p.deedHash,
    metadataCID: p.metadataCID,
    registeredAt: BigInt(p.registeredAt),
  }));
}

// -----------------------------------------------------------------------------
// REGISTRATION REQUESTS (newest first), with rejection reasons included
// -----------------------------------------------------------------------------
export async function graphRequests(): Promise<(RegistrationRequest & { rejectionReason: string | null })[]> {
  const { registrationRequests } = await query<{
    registrationRequests: {
      requestId: string;
      applicant: Address;
      status: number;
      submittedAt: string;
      reviewedBy: Address | null;
      property: { tokenId: string } | null;
      deedHash: Hex;
      metadataCID: string;
      rejectionReason: string | null;
    }[];
  }>(`{
    registrationRequests(first: 1000, orderBy: requestId, orderDirection: desc) {
      requestId applicant status submittedAt reviewedBy property { tokenId }
      deedHash metadataCID rejectionReason
    }
  }`);
  return registrationRequests.map((r) => ({
    id: BigInt(r.requestId),
    applicant: r.applicant,
    status: r.status,
    submittedAt: BigInt(r.submittedAt),
    reviewedBy: r.reviewedBy ?? ZERO_ADDRESS,
    propertyId: r.property ? BigInt(r.property.tokenId) : 0n,
    deedHash: r.deedHash,
    metadataCID: r.metadataCID,
    rejectionReason: r.rejectionReason,
  }));
}

export async function graphRejectionReason(requestId: bigint): Promise<string | null> {
  const { registrationRequest } = await query<{ registrationRequest: { rejectionReason: string | null } | null }>(
    `query ($id: ID!) { registrationRequest(id: $id) { rejectionReason } }`,
    { id: requestId.toString() },
  );
  return registrationRequest?.rejectionReason ?? null;
}

// -----------------------------------------------------------------------------
// MY DEALS + what the escrow owes me, in ONE query
// -----------------------------------------------------------------------------
// `or` combines filters: deals where I'm the buyer OR the seller. Arbiters
// also get every disputed deal. Aliases (myDeals:, disputed:, account:) let
// one request run several queries at once.
type DealRow = {
  dealId: string;
  listingId: string;
  propertyId: string;
  buyer: Address;
  seller: Address;
  kind: number;
  status: number;
  amount: string;
  createdAt: string;
  acceptedAt: string;
};

export async function graphDeals(account: Address, isArbiter: boolean): Promise<{ deals: Deal[]; pending: bigint }> {
  const me = account.toLowerCase();
  const fields = "dealId listingId propertyId buyer seller kind status amount createdAt acceptedAt";
  const data = await query<{ myDeals: DealRow[]; disputed: DealRow[]; account: { pendingWithdrawal: string } | null }>(
    `query ($me: Bytes!, $meId: ID!) {
      myDeals: deals(first: 1000, orderBy: dealId, orderDirection: desc,
                     where: { or: [{ buyer: $me }, { seller: $me }] }) { ${fields} }
      disputed: deals(first: 1000, orderBy: dealId, orderDirection: desc, where: { status: 4 }) { ${fields} }
      account(id: $meId) { pendingWithdrawal }
    }`,
    { me, meId: me },
  );

  const rows = isArbiter ? [...data.myDeals, ...data.disputed] : data.myDeals;
  const seen = new Set<string>();
  const deals: Deal[] = [];
  for (const d of rows.sort((a, b) => Number(b.dealId) - Number(a.dealId))) {
    if (seen.has(d.dealId)) continue; // a disputed deal of my own appears in both lists
    seen.add(d.dealId);
    deals.push({
      id: BigInt(d.dealId),
      listingId: BigInt(d.listingId),
      propertyId: BigInt(d.propertyId),
      buyer: d.buyer,
      seller: d.seller,
      kind: d.kind,
      status: d.status,
      amount: BigInt(d.amount),
      createdAt: BigInt(d.createdAt),
      acceptedAt: BigInt(d.acceptedAt),
    });
  }
  return { deals, pending: BigInt(data.account?.pendingWithdrawal ?? "0") };
}
