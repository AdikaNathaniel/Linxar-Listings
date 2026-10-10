// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract ListingBoard {
    struct Listing {
        uint256 id;
        address owner;      // who posted it (msg.sender)
        string title;
        string location;
        uint256 priceWei;   // price in wei (1 ETH = 10^18 wei)
        bool active;
    }

    Listing[] private listings;   // stored permanently on-chain

    // Changes state, so it costs gas and needs a signed transaction
    function createListing(string calldata title, string calldata location, uint256 priceWei)
        external
        returns (uint256 id)
    {
        id = listings.length;
        listings.push(Listing(id, msg.sender, title, location, priceWei, true));
    }

    // Only the owner may deactivate their listing
    function deactivateListing(uint256 id) external {
        require(listings[id].owner == msg.sender, "Not your listing");
        listings[id].active = false;
    }

    // "view" functions only read data: free, no transaction needed
    function getListing(uint256 id) external view returns (Listing memory) {
        return listings[id];
    }

    function totalListings() external view returns (uint256) {
        return listings.length;
    }
}
