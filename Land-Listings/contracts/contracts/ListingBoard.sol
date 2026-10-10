// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// ← NEW: the INTERFACE of an ERC-721 contract. An interface is a list of a
// contract's functions without their code. It's all ListingBoard needs in
// order to CALL another contract, here our PropertyRegistry.
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title ListingBoard: property listings for LinXar
/// @notice Version 3. Every listing must point to a property NFT in the
///         PropertyRegistry, and only that property's owner, or an agent
///         they approved, can list it.
contract ListingBoard {
    // =========================================================================
    // ENUMS: a fixed list of named options
    // =========================================================================
    enum ListingType { Sale, Rent, Lease }                               // 0, 1, 2
    enum Category { Residential, Commercial, Industrial, Land }          // 0, 1, 2, 3
    enum Status { Available, UnderOffer, Rented, Sold, Withdrawn }       // 0 … 4
    enum PricePeriod { OneOff, PerMonth, PerYear }                       // 0, 1, 2

    // =========================================================================
    // THE LISTING
    // =========================================================================
    struct Listing {
        uint256 id;                // slot 0
        uint256 propertyId;        // ← NEW: which property NFT this listing is for
        address owner;             // slot 2 ┐ who created the listing (owner or agent)
        ListingType listingType;   //        │
        Category category;         //        │ packed together
        Status status;             //        │
        PricePeriod pricePeriod;   //        │
        uint32 sizeSqm;            //        ┘ size in square metres
        uint256 priceWei;          // price in wei (1 ETH = 10^18 wei)
        uint64 createdAt;          // ┐ timestamps (seconds since 1 Jan 1970)
        uint64 updatedAt;          // ┘
        string region;             // e.g. "Greater Accra"
        string metadataCID;        // IPFS fingerprint of the listing's details
    }

    struct NewListing {
        uint256 propertyId;        // ← NEW: the property being listed
        ListingType listingType;
        Category category;
        PricePeriod pricePeriod;
        uint256 priceWei;
        uint32 sizeSqm;
        string region;
        string metadataCID;
    }

    // =========================================================================
    // EVENTS
    // =========================================================================
    // ← CHANGED: propertyId is now an indexed field, so apps can quickly find
    // every listing a property has ever had. (Still max 3 indexed fields.)
    event ListingCreated(
        uint256 indexed id,
        address indexed owner,
        uint256 indexed propertyId,
        Category category,
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
    // CUSTOM ERRORS
    // =========================================================================
    error ListingNotFound(uint256 id);
    error NotListingOwner(uint256 id, address caller);
    error InvalidListing(string reason);
    error NotAuthorizedForProperty(uint256 propertyId, address caller); // ← NEW

    // =========================================================================
    // THE LINK TO THE PROPERTY REGISTRY  ← NEW
    // =========================================================================
    // `immutable`: set once in the constructor, then can NEVER change. Nobody
    // can later point ListingBoard at a fake registry. It's also cheaper to
    // read than normal storage.
    IERC721 public immutable propertyRegistry;

    // The registry's address is passed in at deployment.
    constructor(IERC721 registry) {
        propertyRegistry = registry;
    }

    Listing[] private listings;

    modifier onlyListingOwner(uint256 id) {
        if (id >= listings.length) revert ListingNotFound(id);
        if (listings[id].owner != msg.sender) revert NotListingOwner(id, msg.sender);
        _;
    }

    // =========================================================================
    // WRITE FUNCTIONS
    // =========================================================================

    /// @notice Post a new listing for a property you own (or manage as an agent).
    function createListing(NewListing calldata input) external returns (uint256 id) {
        _validate(input.priceWei, input.metadataCID);
        if (bytes(input.region).length == 0) revert InvalidListing("Region is required");
        _requireAuthorizedFor(input.propertyId); // ← NEW: the anti-fraud check

        id = listings.length;
        listings.push(
            Listing({
                id: id,
                propertyId: input.propertyId, // ← NEW
                owner: msg.sender,
                listingType: input.listingType,
                category: input.category,
                status: Status.Available,
                pricePeriod: input.pricePeriod,
                sizeSqm: input.sizeSqm,
                priceWei: input.priceWei,
                createdAt: uint64(block.timestamp),
                updatedAt: uint64(block.timestamp),
                region: input.region,
                metadataCID: input.metadataCID
            })
        );

        emit ListingCreated(
            id,
            msg.sender,
            input.propertyId, // ← NEW
            input.category,
            input.listingType,
            input.pricePeriod,
            input.priceWei,
            input.sizeSqm,
            input.region,
            input.metadataCID
        );
    }

    /// @notice Change a listing's price, size or details. Listing owner only.
    function updateListing(
        uint256 id,
        PricePeriod pricePeriod,
        uint256 priceWei,
        uint32 sizeSqm,
        string calldata metadataCID
    ) external onlyListingOwner(id) {
        _validate(priceWei, metadataCID);
        Listing storage listing = listings[id];
        listing.pricePeriod = pricePeriod;
        listing.priceWei = priceWei;
        listing.sizeSqm = sizeSqm;
        listing.metadataCID = metadataCID;
        listing.updatedAt = uint64(block.timestamp);
        emit ListingUpdated(id, pricePeriod, priceWei, sizeSqm, metadataCID);
    }

    /// @notice Mark a listing Available, UnderOffer, Rented, Sold or Withdrawn.
    function setStatus(uint256 id, Status status) external onlyListingOwner(id) {
        listings[id].status = status;
        listings[id].updatedAt = uint64(block.timestamp);
        emit ListingStatusChanged(id, status);
    }

    // =========================================================================
    // READ FUNCTIONS
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

    // ← NEW: may msg.sender list this property?
    // This is ListingBoard CALLING ANOTHER CONTRACT: it asks PropertyRegistry
    // who owns the NFT. Contracts calling each other is called "composability".
    function _requireAuthorizedFor(uint256 propertyId) private view {
        // Reverts (ERC721NonexistentToken) if the property was never registered
        address propertyOwner = propertyRegistry.ownerOf(propertyId);

        bool authorized =
            msg.sender == propertyOwner ||                                // the owner themself
            propertyRegistry.isApprovedForAll(propertyOwner, msg.sender) || // an agent for ALL their properties
            propertyRegistry.getApproved(propertyId) == msg.sender;        // an agent for THIS property

        if (!authorized) revert NotAuthorizedForProperty(propertyId, msg.sender);
    }

    function _validate(uint256 priceWei, string calldata metadataCID) private pure {
        if (priceWei == 0) revert InvalidListing("Price must be more than zero");
        if (bytes(metadataCID).length == 0) revert InvalidListing("Metadata CID is required");
    }
}
