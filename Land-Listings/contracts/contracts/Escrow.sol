// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
// ReentrancyGuard: OpenZeppelin's protection against reentrancy attacks
// (explained at withdraw() below).
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// AccessControl: roles. Used here for ARBITER_ROLE.          ← NEW (Milestone 7)
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
// Importing our OWN contract gives us its types: Listing, Status, ListingType…
import {ListingBoard} from "./ListingBoard.sol";

/// @title Escrow: holds a buyer's money until the deal is done
/// @notice Nobody can touch the locked ETH: not the seller, not the agent,
///         not the developer. Only the rules below decide where it goes.
///         For a sale, the money and the property NFT change hands in ONE
///         transaction (an "atomic swap"): both happen, or neither does.
contract Escrow is ReentrancyGuard, AccessControl {
    // ← NEW: whoever holds this role can settle disputes. The admin can grant
    // it to several mediators, or take it away, without redeploying.
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

    // =========================================================================
    // TYPES
    // =========================================================================
    enum DealKind { Purchase, RentalDeposit }
    enum DealStatus { Funded, Accepted, Completed, Refunded, Disputed }

    struct Deal {
        uint256 id;
        uint256 listingId;
        uint256 propertyId;   // the property NFT (moves to the buyer on a completed Purchase)
        address buyer;        // ┐ packed into one slot
        DealKind kind;        // │
        DealStatus status;    // ┘
        address seller;       // ┐ the listing's owner: who gets paid
        uint64 createdAt;     // │
        uint64 acceptedAt;    // ┘ starts the buyer's 7-day confirmation window
        uint256 amount;       // ETH locked in this deal, in wei
    }

    // `constant`: fixed in the code forever, and costs no storage.
    // Solidity understands time units: 7 days = 604,800 seconds.
    uint256 public constant CONFIRM_WINDOW = 7 days;

    // Set once at deployment, never changeable (`immutable`)
    ListingBoard public immutable listingBoard;
    IERC721 public immutable propertyRegistry;

    Deal[] private deals;

    // PULL PAYMENTS: money owed to each address, waiting to be withdrawn.
    // Completing or refunding a deal only INCREASES a number here; the actual
    // ETH only leaves the contract when the person calls withdraw().
    mapping(address => uint256) public pendingWithdrawals;

    // =========================================================================
    // EVENTS
    // =========================================================================
    event DealOpened(
        uint256 indexed dealId,
        uint256 indexed listingId,
        address indexed buyer,
        address seller,
        DealKind kind,
        uint256 amount
    );
    event DealAccepted(uint256 indexed dealId);
    event DealCompleted(uint256 indexed dealId);
    event DealRefunded(uint256 indexed dealId);
    event DealDisputed(uint256 indexed dealId, address indexed raisedBy);
    event Withdrawal(address indexed account, uint256 amount);

    // =========================================================================
    // CUSTOM ERRORS
    // =========================================================================
    error DealNotFound(uint256 dealId);
    error NotAllowed(uint256 dealId, address caller);
    error WrongStatus(uint256 dealId, DealStatus current);
    error ListingNotAvailable(uint256 listingId);
    error CannotBuyOwnListing();
    error WrongAmount(uint256 expected, uint256 sent);
    error EscrowNotApprovedForProperty(uint256 propertyId);
    error ConfirmWindowStillOpen(uint256 endsAt);
    error NothingToWithdraw();
    error TransferFailed();

    // ← CHANGED: no arbiter address any more. The deployer becomes the ADMIN,
    // who then grants ARBITER_ROLE to whoever should settle disputes.
    constructor(ListingBoard board, IERC721 registry) {
        listingBoard = board;
        propertyRegistry = registry;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // Each step of the flow is only allowed from ONE state, so a deal can
    // never be completed twice, refunded after completing, and so on.
    modifier inStatus(uint256 dealId, DealStatus expected) {
        if (dealId >= deals.length) revert DealNotFound(dealId);
        if (deals[dealId].status != expected) revert WrongStatus(dealId, deals[dealId].status);
        _;
    }

    // =========================================================================
    // 1. OPEN: the buyer locks their money in a deal
    // =========================================================================
    /// @notice `payable` = this function can RECEIVE ETH. The amount sent
    ///         arrives as `msg.value` and is added to this contract's balance.
    function openDeal(uint256 listingId) external payable returns (uint256 dealId) {
        // Read the listing from ListingBoard (another contract call)
        ListingBoard.Listing memory listing = listingBoard.getListing(listingId);
        if (listing.status != ListingBoard.Status.Available) revert ListingNotAvailable(listingId);
        if (listing.owner == msg.sender) revert CannotBuyOwnListing();

        // A Sale listing → a Purchase that must pay the exact price.
        // A Rent/Lease listing → a deposit of any (non-zero) amount.
        DealKind kind = listing.listingType == ListingBoard.ListingType.Sale
            ? DealKind.Purchase
            : DealKind.RentalDeposit;
        if (kind == DealKind.Purchase) {
            if (msg.value != listing.priceWei) revert WrongAmount(listing.priceWei, msg.value);
        } else {
            if (msg.value == 0) revert WrongAmount(1, 0);
        }

        dealId = deals.length;
        deals.push(
            Deal({
                id: dealId,
                listingId: listingId,
                propertyId: listing.propertyId,
                buyer: msg.sender,
                kind: kind,
                status: DealStatus.Funded,
                seller: listing.owner,
                createdAt: uint64(block.timestamp),
                acceptedAt: 0,
                amount: msg.value
            })
        );
        emit DealOpened(dealId, listingId, msg.sender, listing.owner, kind, msg.value);
    }

    // =========================================================================
    // 2. BEFORE ACCEPTANCE: either side can walk away, and the buyer is refunded
    // =========================================================================
    function cancelDeal(uint256 dealId) external inStatus(dealId, DealStatus.Funded) {
        if (msg.sender != deals[dealId].buyer) revert NotAllowed(dealId, msg.sender);
        _refund(dealId);
    }

    function rejectDeal(uint256 dealId) external inStatus(dealId, DealStatus.Funded) {
        if (msg.sender != deals[dealId].seller) revert NotAllowed(dealId, msg.sender);
        _refund(dealId);
    }

    // =========================================================================
    // 3. ACCEPT: the seller commits to the deal
    // =========================================================================
    function acceptDeal(uint256 dealId) external inStatus(dealId, DealStatus.Funded) {
        Deal storage deal = deals[dealId];
        if (msg.sender != deal.seller) revert NotAllowed(dealId, msg.sender);

        // For a sale, check NOW that the escrow will be able to hand over the
        // property later. (The owner must have called approve or
        // setApprovalForAll on the registry for this escrow contract.)
        if (deal.kind == DealKind.Purchase && !_escrowCanTransfer(deal.propertyId)) {
            revert EscrowNotApprovedForProperty(deal.propertyId);
        }

        deal.status = DealStatus.Accepted;
        deal.acceptedAt = uint64(block.timestamp);
        emit DealAccepted(dealId);
    }

    // =========================================================================
    // 4. COMPLETE: the buyer confirms, or stays silent too long
    // =========================================================================
    function confirmDeal(uint256 dealId) external inStatus(dealId, DealStatus.Accepted) {
        if (msg.sender != deals[dealId].buyer) revert NotAllowed(dealId, msg.sender);
        _complete(dealId);
    }

    /// @notice Protects the seller from a buyer who never responds: after the
    ///         7-day window, the seller can complete the deal themselves.
    function finalizeAfterTimeout(uint256 dealId) external inStatus(dealId, DealStatus.Accepted) {
        Deal storage deal = deals[dealId];
        if (msg.sender != deal.seller) revert NotAllowed(dealId, msg.sender);
        uint256 endsAt = deal.acceptedAt + CONFIRM_WINDOW;
        if (block.timestamp <= endsAt) revert ConfirmWindowStillOpen(endsAt);
        _complete(dealId);
    }

    // =========================================================================
    // 5. DISPUTES: the brief's "dispute resolution tools"
    // =========================================================================
    function raiseDispute(uint256 dealId) external inStatus(dealId, DealStatus.Accepted) {
        Deal storage deal = deals[dealId];
        if (msg.sender != deal.buyer && msg.sender != deal.seller) revert NotAllowed(dealId, msg.sender);
        deal.status = DealStatus.Disputed;
        emit DealDisputed(dealId, msg.sender);
    }

    /// @notice Only an ARBITER decides: pay the seller, or refund the buyer.
    /// ← CHANGED: `onlyRole(ARBITER_ROLE)` replaces the old single-address check
    function resolveDispute(uint256 dealId, bool releaseToSeller)
        external
        onlyRole(ARBITER_ROLE)
        inStatus(dealId, DealStatus.Disputed)
    {
        if (releaseToSeller) _complete(dealId);
        else _refund(dealId);
    }

    // =========================================================================
    // 6. WITHDRAW: actually receive the ETH you're owed
    // =========================================================================
    /// @dev REENTRANCY: when a contract sends ETH to another CONTRACT, that
    ///      contract's code runs, and it could call withdraw() AGAIN before this
    ///      one finishes, draining the escrow. (That's how the 2016 DAO hack
    ///      stole about $60 million.) Two defences, used together:
    ///      1. CHECKS → EFFECTS → INTERACTIONS: set the balance to 0 BEFORE
    ///         sending, so a second call finds nothing to withdraw.
    ///      2. `nonReentrant` (from ReentrancyGuard): blocks any call back into
    ///         this function while it's still running.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];           // CHECKS
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;                         // EFFECTS

        (bool sent, ) = payable(msg.sender).call{value: amount}(""); // INTERACTIONS
        if (!sent) revert TransferFailed();
        emit Withdrawal(msg.sender, amount);
    }

    // =========================================================================
    // READ FUNCTIONS
    // =========================================================================
    function getDeal(uint256 dealId) external view returns (Deal memory) {
        if (dealId >= deals.length) revert DealNotFound(dealId);
        return deals[dealId];
    }

    function totalDeals() external view returns (uint256) {
        return deals.length;
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    // The deal succeeded: the seller is owed the money, and for a Purchase
    // the property NFT moves to the buyer, in the same transaction.
    function _complete(uint256 dealId) private {
        Deal storage deal = deals[dealId];
        deal.status = DealStatus.Completed;           // EFFECTS first…
        pendingWithdrawals[deal.seller] += deal.amount;

        if (deal.kind == DealKind.Purchase) {         // …INTERACTION last
            address currentOwner = propertyRegistry.ownerOf(deal.propertyId);
            // If this transfer fails, the WHOLE transaction reverts, including
            // the payment above. Money and property move together, or not at all.
            propertyRegistry.transferFrom(currentOwner, deal.buyer, deal.propertyId);
        }
        emit DealCompleted(dealId);
    }

    // The deal was cancelled, rejected or lost a dispute: the buyer is owed
    // their money back.
    function _refund(uint256 dealId) private {
        Deal storage deal = deals[dealId];
        deal.status = DealStatus.Refunded;
        pendingWithdrawals[deal.buyer] += deal.amount;
        emit DealRefunded(dealId);
    }

    // Has the property's owner allowed THIS contract to move their NFT?
    function _escrowCanTransfer(uint256 propertyId) private view returns (bool) {
        address owner = propertyRegistry.ownerOf(propertyId);
        return propertyRegistry.isApprovedForAll(owner, address(this))
            || propertyRegistry.getApproved(propertyId) == address(this);
    }
}
