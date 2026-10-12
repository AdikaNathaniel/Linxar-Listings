// =============================================================================
// Handlers for ListingBoard events
// =============================================================================
// ListingCreated carries every filterable field (Milestone 4 put them in the
// event on purpose), so the whole listing can be built from the event alone.

import { ListingCreated, ListingStatusChanged, ListingUpdated } from "../generated/ListingBoard/ListingBoard";
import { Listing } from "../generated/schema";

const AVAILABLE = 0; // every new listing starts Available

export function handleListingCreated(event: ListingCreated): void {
  const listing = new Listing(event.params.id.toString());
  listing.listingId = event.params.id;
  listing.property = event.params.propertyId.toString(); // link to the Property entity
  listing.propertyId = event.params.propertyId;
  listing.owner = event.params.owner;
  // Link to the lister's Agent record (same id: the address). If they've
  // never had a badge, there's no Agent record and the link resolves to null.
  listing.agent = event.params.owner.toHexString();
  listing.category = event.params.category;
  listing.listingType = event.params.listingType;
  listing.status = AVAILABLE;
  listing.pricePeriod = event.params.pricePeriod;
  listing.priceWei = event.params.priceWei;
  listing.sizeSqm = event.params.sizeSqm;
  listing.region = event.params.region;
  listing.metadataCID = event.params.metadataCID;
  listing.createdAt = event.block.timestamp;
  listing.updatedAt = event.block.timestamp;
  listing.save();
}

export function handleListingUpdated(event: ListingUpdated): void {
  const listing = Listing.load(event.params.id.toString());
  if (listing == null) return;
  listing.pricePeriod = event.params.pricePeriod;
  listing.priceWei = event.params.priceWei;
  listing.sizeSqm = event.params.sizeSqm;
  listing.metadataCID = event.params.metadataCID;
  listing.updatedAt = event.block.timestamp;
  listing.save();
}

export function handleListingStatusChanged(event: ListingStatusChanged): void {
  const listing = Listing.load(event.params.id.toString());
  if (listing == null) return;
  listing.status = event.params.status;
  listing.updatedAt = event.block.timestamp;
  listing.save();
}
