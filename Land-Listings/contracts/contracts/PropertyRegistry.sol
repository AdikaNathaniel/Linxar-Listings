// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
// AccessControl: OpenZeppelin's standard ROLE system. Each role is a name
// (a bytes32 hash) plus the list of addresses that hold it.
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PropertyRegistry v2: every real property is a unique NFT,
///        created only after a trusted VERIFIER has checked the deed
/// @notice Owners REQUEST registration (with their documents on IPFS).
///         A verifier (e.g. after checking with the Lands Commission)
///         approves or rejects. Only on approval is the NFT minted.
///         This addresses the ORACLE PROBLEM: the chain can't check a deed
///         itself, so we decide WHO is trusted to vouch for it, and every
///         decision they make is recorded publicly.
//  Inherits from TWO OpenZeppelin contracts: ERC721 (the NFT) and AccessControl (roles)
contract PropertyRegistry is ERC721, AccessControl {
    // =========================================================================
    // ROLES
    // =========================================================================
    // A role is identified by a 32-byte hash of its name. `constant` keeps it
    // out of storage. AccessControl also provides DEFAULT_ADMIN_ROLE: whoever
    // holds it can grant and revoke every other role.
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // =========================================================================
    // TYPES
    // =========================================================================
    struct Property {
        bytes32 deedHash;      // fingerprint of the title deed number
        uint64 registeredAt;   // when it was approved and minted
        string metadataCID;    // IPFS: address, size, photos, documents…
    }

    enum RequestStatus { Pending, Approved, Rejected }

    // An owner's application to register a property, waiting for a verifier
    struct Request {
        uint256 id;
        address applicant;      // ┐ who asked, and who'll receive the NFT
        RequestStatus status;   // │ packed together
        uint64 submittedAt;     // ┘
        address reviewedBy;     // the verifier who decided (zero while pending)
        uint256 propertyId;     // the NFT created on approval
        bytes32 deedHash;
        string metadataCID;
    }

    // =========================================================================
    // EVENTS: a public, permanent record of every request and every decision
    // =========================================================================
    event RegistrationRequested(
        uint256 indexed requestId,
        address indexed applicant,
        bytes32 indexed deedHash,
        string metadataCID
    );
    event RegistrationApproved(uint256 indexed requestId, uint256 indexed propertyId, address indexed verifier);
    event RegistrationRejected(uint256 indexed requestId, address indexed verifier, string reason);
    event PropertyRegistered(
        uint256 indexed propertyId,
        address indexed owner,
        bytes32 indexed deedHash,
        string metadataCID
    );

    // =========================================================================
    // CUSTOM ERRORS
    // =========================================================================
    error DeedAlreadyRegistered(bytes32 deedHash);
    error InvalidProperty(string reason);
    error RequestNotFound(uint256 requestId);
    error RequestNotPending(uint256 requestId, RequestStatus status);

    // =========================================================================
    // STORAGE
    // =========================================================================
    uint256 private _nextPropertyId;
    mapping(uint256 => Property) private _properties;
    mapping(bytes32 => bool) public isDeedRegistered;   // true once APPROVED
    Request[] private _requests;

    // The account that deploys the registry becomes its ADMIN.
    // `_grantRole` is AccessControl's internal function to give a role.
    constructor() ERC721("LinXar Property", "LXP") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // =========================================================================
    // STEP 1: anyone REQUESTS registration of their property
    // =========================================================================
    function requestRegistration(bytes32 deedHash, string calldata metadataCID)
        external
        returns (uint256 requestId)
    {
        if (deedHash == bytes32(0)) revert InvalidProperty("Deed hash is required");
        if (bytes(metadataCID).length == 0) revert InvalidProperty("Metadata CID is required");
        // Don't even accept a request for a deed that's already registered
        if (isDeedRegistered[deedHash]) revert DeedAlreadyRegistered(deedHash);

        requestId = _requests.length;
        _requests.push(
            Request({
                id: requestId,
                applicant: msg.sender,
                status: RequestStatus.Pending,
                submittedAt: uint64(block.timestamp),
                reviewedBy: address(0),
                propertyId: 0,
                deedHash: deedHash,
                metadataCID: metadataCID
            })
        );
        emit RegistrationRequested(requestId, msg.sender, deedHash, metadataCID);
    }

    // =========================================================================
    // STEP 2a: a VERIFIER approves, and the NFT is minted to the applicant
    // =========================================================================
    /// @notice `onlyRole(VERIFIER_ROLE)`: AccessControl's modifier. Anyone
    ///         without the role is rejected with AccessControlUnauthorizedAccount.
    function approveRegistration(uint256 requestId)
        external
        onlyRole(VERIFIER_ROLE)
        returns (uint256 propertyId)
    {
        Request storage request = _pendingRequest(requestId);

        // Two people may have requested the SAME deed (e.g. the real owner and
        // a scammer). Whichever is approved first wins, and the deed is then
        // locked forever, so a second approval is impossible.
        if (isDeedRegistered[request.deedHash]) revert DeedAlreadyRegistered(request.deedHash);

        // EFFECTS first…
        isDeedRegistered[request.deedHash] = true;
        propertyId = _nextPropertyId++;
        _properties[propertyId] = Property({
            deedHash: request.deedHash,
            registeredAt: uint64(block.timestamp),
            metadataCID: request.metadataCID
        });
        request.status = RequestStatus.Approved;
        request.reviewedBy = msg.sender;
        request.propertyId = propertyId;

        // …then mint the NFT to the APPLICANT (not to the verifier!)
        _mint(request.applicant, propertyId);

        emit RegistrationApproved(requestId, propertyId, msg.sender);
        emit PropertyRegistered(propertyId, request.applicant, request.deedHash, request.metadataCID);
    }

    // =========================================================================
    // STEP 2b: a VERIFIER rejects, giving a public reason
    // =========================================================================
    function rejectRegistration(uint256 requestId, string calldata reason) external onlyRole(VERIFIER_ROLE) {
        Request storage request = _pendingRequest(requestId);
        request.status = RequestStatus.Rejected;
        request.reviewedBy = msg.sender;
        emit RegistrationRejected(requestId, msg.sender, reason);
    }

    // =========================================================================
    // READ FUNCTIONS
    // =========================================================================
    function getProperty(uint256 propertyId) external view returns (Property memory) {
        _requireOwned(propertyId);
        return _properties[propertyId];
    }

    function tokenURI(uint256 propertyId) public view override returns (string memory) {
        _requireOwned(propertyId);
        return string.concat("ipfs://", _properties[propertyId].metadataCID);
    }

    function totalProperties() external view returns (uint256) {
        return _nextPropertyId;
    }

    function getRequest(uint256 requestId) external view returns (Request memory) {
        if (requestId >= _requests.length) revert RequestNotFound(requestId);
        return _requests[requestId];
    }

    function totalRequests() external view returns (uint256) {
        return _requests.length;
    }

    // =========================================================================
    // REQUIRED BY INHERITING TWO CONTRACTS
    // =========================================================================
    /// @dev Both ERC721 and AccessControl define `supportsInterface` (how other
    ///      contracts and wallets ask "do you support standard X?"). When two
    ///      parents define the same function, Solidity makes us choose, so we
    ///      override BOTH and let `super` combine their answers.
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================
    function _pendingRequest(uint256 requestId) private view returns (Request storage request) {
        if (requestId >= _requests.length) revert RequestNotFound(requestId);
        request = _requests[requestId];
        if (request.status != RequestStatus.Pending) revert RequestNotPending(requestId, request.status);
    }
}
