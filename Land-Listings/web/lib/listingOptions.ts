// =============================================================================
// The contract's enums, with labels for the website
// =============================================================================
// On-chain, an enum is just a number: Category.Land is stored as 3. These
// arrays turn the numbers into words, so the ORDER MUST MATCH the contract:
//   enum Category { Residential, Commercial, Industrial, Land }
// labels[0] is "Residential", labels[3] is "Land", and so on.

export const LISTING_TYPES = ["For sale", "For rent", "For lease"] as const; // ListingType
export const CATEGORIES = ["Residential", "Commercial", "Industrial", "Land"] as const; // Category
export const STATUSES = ["Available", "Under offer", "Rented", "Sold", "Withdrawn"] as const; // Status
export const PRICE_PERIODS = ["", "/ month", "/ year"] as const; // PricePeriod (OneOff shows nothing)

export const ListingType = { Sale: 0, Rent: 1, Lease: 2 } as const;
export const Status = { Available: 0, UnderOffer: 1, Rented: 2, Sold: 3, Withdrawn: 4 } as const;
export const PricePeriod = { OneOff: 0, PerMonth: 1, PerYear: 2 } as const;

// Ghana's 16 regions. Region is stored on-chain, so buyers can filter by it.
export const REGIONS = [
  "Ahafo",
  "Ashanti",
  "Bono",
  "Bono East",
  "Central",
  "Eastern",
  "Greater Accra",
  "North East",
  "Northern",
  "Oti",
  "Savannah",
  "Upper East",
  "Upper West",
  "Volta",
  "Western",
  "Western North",
] as const;

// Amenities are stored in the IPFS metadata, not on-chain.
export const AMENITIES = [
  "Water",
  "Electricity",
  "Borehole",
  "Parking",
  "Security",
  "Fenced",
  "Furnished",
  "Air conditioning",
  "Internet",
  "Tarred road access",
] as const;
