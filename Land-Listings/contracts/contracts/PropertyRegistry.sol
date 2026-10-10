// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Import OpenZeppelin's standard, audited ERC-721 (NFT) contract.
// ERC-721 = the standard for UNIQUE tokens: each one has its own ID and
// exactly one owner. Wallets like MetaMask understand any ERC-721 token.
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title PropertyRegistry: every real property is a unique NFT
/// @notice Owning the token = owning the on-chain record of that property.
///         Each title deed can only ever be registered once.
//  `is ERC721` means this contract INHERITS everything ERC721 can do:
//  ownerOf(), balanceOf(), transferFrom(), approve()… We don't rewrite any of it.
contract PropertyRegistry is ERC721 {
    // What we store about each property
    struct Property {
        bytes32 deedHash;      // fingerprint of the title deed's ID (see below)
        uint64 registeredAt;   // when it was registered (block timestamp)
        string metadataCID;    // IPFS: address, size, photos, survey plan…
    }

    // EVENT: announced every time a property is registered
    event PropertyRegistered(
        uint256 indexed propertyId,
        address indexed owner,
        bytes32 indexed deedHash,
        string metadataCID
    );

    // CUSTOM ERRORS
    error DeedAlreadyRegistered(bytes32 deedHash);
    error InvalidProperty(string reason);

    uint256 private _nextPropertyId;                  // next token ID: 0, 1, 2…
    mapping(uint256 => Property) private _properties; // token ID → property details

    // A MAPPING is like a dictionary: give it a key, get back a value.
    // Here: deed fingerprint → has it been registered already? (true/false)
    // `public` makes Solidity create a free read function for it automatically.
    mapping(bytes32 => bool) public isDeedRegistered;

    // The CONSTRUCTOR runs once, at deployment. It passes the token's name
    // and symbol to OpenZeppelin's ERC721 (like a currency name and code).
    constructor() ERC721("LinXar Property", "LXP") {}

    /// @notice Register a property. The sender receives its NFT.
    /// @param deedHash Fingerprint of the title deed number, e.g.
    ///        keccak256("GA-12345-2019"). Hashing gives every deed a fixed
    ///        32-byte ID, and the same deed number always gives the same hash,
    ///        which is exactly what lets us detect duplicates.
    /// @dev   For now anyone can register. In Milestone 7, only trusted
    ///        verifiers (e.g. after checking with the Lands Commission) will.
    function registerProperty(bytes32 deedHash, string calldata metadataCID)
        external
        returns (uint256 propertyId)
    {
        // CHECKS: reject bad input
        if (deedHash == bytes32(0)) revert InvalidProperty("Deed hash is required");
        if (bytes(metadataCID).length == 0) revert InvalidProperty("Metadata CID is required");

        // THE ANTI-FRAUD RULE: one deed, one registration, ever.
        // If the same plot is registered again, this reverts the whole
        // transaction, so nobody can create a second "owner" of it.
        if (isDeedRegistered[deedHash]) revert DeedAlreadyRegistered(deedHash);

        // EFFECTS: update our records first…
        isDeedRegistered[deedHash] = true;
        propertyId = _nextPropertyId++; // use the current number, then add 1
        _properties[propertyId] = Property({
            deedHash: deedHash,
            registeredAt: uint64(block.timestamp),
            metadataCID: metadataCID
        });

        // …then create the NFT. `_mint` comes from OpenZeppelin: it records
        // `msg.sender` as the owner of token `propertyId` and emits the
        // standard ERC-721 Transfer event (from address 0 = newly created).
        _mint(msg.sender, propertyId);

        emit PropertyRegistered(propertyId, msg.sender, deedHash, metadataCID);
    }

    /// @notice Read a property's stored details
    function getProperty(uint256 propertyId) external view returns (Property memory) {
        // From OpenZeppelin: reverts with ERC721NonexistentToken if the ID
        // doesn't exist, instead of silently returning empty data.
        _requireOwned(propertyId);
        return _properties[propertyId];
    }

    /// @notice Where wallets and NFT marketplaces find the token's details.
    /// @dev `override` replaces OpenZeppelin's default version with ours.
    function tokenURI(uint256 propertyId) public view override returns (string memory) {
        _requireOwned(propertyId);
        return string.concat("ipfs://", _properties[propertyId].metadataCID);
    }

    /// @notice How many properties have ever been registered
    function totalProperties() external view returns (uint256) {
        return _nextPropertyId;
    }
}
