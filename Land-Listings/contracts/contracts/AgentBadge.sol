// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AgentBadge: "Verified Agent" badges as SOULBOUND NFTs
/// @notice The brief asks for a "verification badge for trusted agents/sellers".
///         Each badge is an NFT that:
///           - only a VERIFIER can issue (after checking the agent's licence),
///           - a verifier can REVOKE (burn) if the agent misbehaves,
///           - can NEVER be transferred or sold: it's bound to the agent's
///             wallet, like a certificate with their name on it. That's what
///             "soulbound" means.
///         Anyone can check `isVerified(agent)` for free.
contract AgentBadge is ERC721, AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    struct Badge {
        uint64 issuedAt;
        address issuedBy;      // the verifier who vouched for this agent
        string profileCID;     // IPFS: name, licence number, agency, contact…
    }

    // One badge per agent. The token id is simply the agent's address turned
    // into a number, so "does this agent have a badge?" is a direct lookup.
    mapping(uint256 => Badge) private _badges;

    event AgentVerified(address indexed agent, address indexed verifier, string profileCID);
    event AgentRevoked(address indexed agent, address indexed verifier);

    error AlreadyVerified(address agent);
    error NotVerified(address agent);
    error Soulbound(); // badges can't be transferred
    error InvalidProfile();

    constructor() ERC721("LinXar Verified Agent", "LXA") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // An address (20 bytes) fits in a uint256 (32 bytes), so it can be a token id
    function badgeId(address agent) public pure returns (uint256) {
        return uint256(uint160(agent));
    }

    /// @notice Free check: is this address a verified agent right now?
    function isVerified(address agent) public view returns (bool) {
        // `_ownerOf` returns address(0) for a token that doesn't exist
        return _ownerOf(badgeId(agent)) != address(0);
    }

    // =========================================================================
    // VERIFIER ACTIONS
    // =========================================================================
    function issueBadge(address agent, string calldata profileCID) external onlyRole(VERIFIER_ROLE) {
        if (bytes(profileCID).length == 0) revert InvalidProfile();
        if (isVerified(agent)) revert AlreadyVerified(agent);
        uint256 id = badgeId(agent);
        _badges[id] = Badge({ issuedAt: uint64(block.timestamp), issuedBy: msg.sender, profileCID: profileCID });
        _mint(agent, id);
        emit AgentVerified(agent, msg.sender, profileCID);
    }

    function revokeBadge(address agent) external onlyRole(VERIFIER_ROLE) {
        if (!isVerified(agent)) revert NotVerified(agent);
        uint256 id = badgeId(agent);
        delete _badges[id];
        _burn(id); // destroys the NFT: the badge simply disappears from the agent's wallet
        emit AgentRevoked(agent, msg.sender);
    }

    // =========================================================================
    // READ FUNCTIONS
    // =========================================================================
    function getBadge(address agent) external view returns (Badge memory) {
        if (!isVerified(agent)) revert NotVerified(agent);
        return _badges[badgeId(agent)];
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string.concat("ipfs://", _badges[id].profileCID);
    }

    // =========================================================================
    // SOULBOUND: block every transfer
    // =========================================================================
    /// @dev OpenZeppelin's ERC721 sends EVERY ownership change through this one
    ///      internal function, `_update`: minting (from = nobody), burning
    ///      (to = nobody), and transfers (from someone, to someone). By
    ///      OVERRIDING it, we change how the inherited code behaves: mint and
    ///      burn still work, but a transfer between two real addresses is
    ///      refused. This one rule makes the badge soulbound.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth); // `super` = run OpenZeppelin's original version
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
