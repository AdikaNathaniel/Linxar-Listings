// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ListingBoard: property listings for LinXar
/// @notice Version 2. Listings now support sale/rent/lease, the brief's four
///         categories, an availability status, and photos/descriptions on IPFS.
contract ListingBoard {
    // =========================================================================
    // ENUMS: a fixed list of named options
    // =========================================================================
    // An enum is stored as a small number (0, 1, 2…), so it's cheap, but in
    // code we use readable names. Order matters: the first option is 0.
    enum ListingType { Sale, Rent, Lease }                               // 0, 1, 2
    enum Category { Residential, Commercial, Industrial, Land }          // 0, 1, 2, 3
    enum Status { Available, UnderOffer, Rented, Sold, Withdrawn }       // 0 … 4
    enum PricePeriod { OneOff, PerMonth, PerYear }                       // 0, 1, 2

    // =========================================================================
    // THE LISTING
    // =========================================================================
    // Only short fields that people FILTER on are stored on-chain.
    // Long content (title, description, photos, amenities, map location) lives
    // in a JSON file on IPFS. We keep just its CID: its unique fingerprint.
    //
    // Field ORDER matters for gas. Ethereum storage works in 32-byte "slots".
    // Small fields placed next to each other share one slot ("packing"):
    //   slot 1: owner (20 bytes) + 4 enums (1 byte each) + sizeSqm (4 bytes) = 28 bytes
    //   slot 3: createdAt (8 bytes) + updatedAt (8 bytes) = 16 bytes
    // Fewer slots means less gas for every listing created.
    struct Listing {
        uint256 id;                // slot 0
        address owner;             // slot 1 ┐
        ListingType listingType;   //        │
        Category category;         //        │ packed together
        Status status;             //        │
        PricePeriod pricePeriod;   //        │
        uint32 sizeSqm;            //        ┘ size in square metres (max ~4 billion)
        uint256 priceWei;          // slot 2: price in wei (1 ETH = 10^18 wei)
        uint64 createdAt;          // slot 3 ┐ timestamps (seconds since 1 Jan 1970)
        uint64 updatedAt;          //        ┘
        string region;             // e.g. "Greater Accra"
        string metadataCID;        // IPFS fingerprint of the listing's details
    }

    // What a seller provides when creating a listing. Grouping the inputs in
    // one struct keeps the function tidy, and avoids Solidity's
    // "stack too deep" limit on how many separate variables a function can use.
    struct NewListing {
        ListingType listingType;
        Category category;
        PricePeriod pricePeriod;
        uint256 priceWei;
        uint32 sizeSqm;
        string region;
        string metadataCID;
    }

    // =========================================================================
    // EVENTS: announcements for the outside world (websites, The Graph)
    // =========================================================================
    // ListingCreated carries every filterable field, so an indexer can build a
    // searchable database from events alone, without reading storage.
    // Up to 3 fields can be `indexed` (searchable): id, owner, category.
    event ListingCreated(
        uint256 indexed id,
        address indexed owner,
        Category indexed category,
        ListingType listingType,
        PricePeriod pricePeriod,
        uint256 priceWei,
        uint32 sizeSqm,
        string region,
        string metadataCID
    );
    event ListingUpdated(uint256 indexed id, PricePeriod pricePeriod, uint256 priceWei, uint32 sizeSqm, string metadataCID);
    event ListingStatusChanged(uint256 indexed id, Status status);

    // =========================================================================
    // CUSTOM ERRORS: cheaper and more informative than require("text")
    // =========================================================================
    // A custom error stores only a 4-byte code plus its values, instead of a
    // full text message, which saves gas. It can also carry useful data,
    // e.g. WHICH listing and WHO tried to change it.
    error ListingNotFound(uint256 id);
    error NotListingOwner(uint256 id, address caller);
    error InvalidListing(string reason);

    Listing[] private listings;   // stored permanently on-chain

    // =========================================================================
    // MODIFIER: a reusable check that runs before a function's body
    // =========================================================================
    // Any function marked `onlyListingOwner(id)` first runs these checks.
    // `_;` means "now run the rest of the function". Writing the rule once
    // here means it can't be forgotten in one of the functions.
    modifier onlyListingOwner(uint256 id) {
        if (id >= listings.length) revert ListingNotFound(id);
        if (listings[id].owner != msg.sender) revert NotListingOwner(id, msg.sender);
        _;
    }

    // =========================================================================
    // WRITE FUNCTIONS (transactions: cost gas, need a signature)
    // =========================================================================

    /// @notice Post a new listing. The sender becomes its owner.
    function createListing(NewListing calldata input) external returns (uint256 id) {
        _validate(input.priceWei, input.metadataCID);
        if (bytes(input.region).length == 0) revert InvalidListing("Region is required");

        id = listings.length;
        listings.push(
            Listing({
                id: id,
                owner: msg.sender,                 // whoever signed the transaction
                listingType: input.listingType,
                category: input.category,
                status: Status.Available,          // every new listing starts available
                pricePeriod: input.pricePeriod,
                sizeSqm: input.sizeSqm,
                priceWei: input.priceWei,
                createdAt: uint64(block.timestamp), // the current block's time
                updatedAt: uint64(block.timestamp),
                region: input.region,
                metadataCID: input.metadataCID
            })
        );

        emit ListingCreated(
            id,
            msg.sender,
            input.category,
            input.listingType,
            input.pricePeriod,
            input.priceWei,
            input.sizeSqm,
            input.region,
            input.metadataCID
        );
    }

    /// @notice Change a listing's price, size or details. Owner only.
    /// @dev Type, category and region stay fixed: a different property
    ///      should be a new listing.
    function updateListing(
        uint256 id,
        PricePeriod pricePeriod,
        uint256 priceWei,
        uint32 sizeSqm,
        string calldata metadataCID
    ) external onlyListingOwner(id) {
        _validate(priceWei, metadataCID);

        // `storage` means "work directly on the saved listing", not a copy.
        // Changes to `listing` here are written to the blockchain.
        Listing storage listing = listings[id];
        listing.pricePeriod = pricePeriod;
        listing.priceWei = priceWei;
        listing.sizeSqm = sizeSqm;
        listing.metadataCID = metadataCID;
        listing.updatedAt = uint64(block.timestamp);

        emit ListingUpdated(id, pricePeriod, priceWei, sizeSqm, metadataCID);
    }

    /// @notice Mark a listing Available, UnderOffer, Rented, Sold or Withdrawn.
    ///         Replaces the old deactivateListing (now: setStatus(id, Withdrawn)).
    function setStatus(uint256 id, Status status) external onlyListingOwner(id) {
        listings[id].status = status;
        listings[id].updatedAt = uint64(block.timestamp);
        emit ListingStatusChanged(id, status);
    }

    // =========================================================================
    // READ FUNCTIONS (free calls, no transaction)
    // =========================================================================

    function getListing(uint256 id) external view returns (Listing memory) {
        if (id >= listings.length) revert ListingNotFound(id);
        return listings[id];
    }

    function totalListings() external view returns (uint256) {
        return listings.length;
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================
    // `private` = only this contract can call it. `pure` = reads no blockchain
    // data at all; it only checks the values it's given.
    function _validate(uint256 priceWei, string calldata metadataCID) private pure {
        if (priceWei == 0) revert InvalidListing("Price must be more than zero");
        if (bytes(metadataCID).length == 0) revert InvalidListing("Metadata CID is required");
    }
}
