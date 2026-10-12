// =============================================================================
// Tests for PropertyRegistry.sol v2: verified property NFTs
// =============================================================================
// Owners REQUEST registration; only a VERIFIER can approve (mint the NFT)
// or reject. Run with:  npm run test
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, keccak256, toBytes, zeroHash } from "viem";

// The contract stores only the keccak256 hash of a deed number
function deedHash(deedNumber: string) {
  return keccak256(toBytes(deedNumber));
}

const DEED_A = deedHash("GA-12345-2019");
const DEED_B = deedHash("AS-67890-2021");
const SAMPLE_CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
const RequestStatus = { Pending: 0, Approved: 1, Rejected: 2 } as const;

describe("PropertyRegistry", async function () {
  const { viem, networkHelpers } = await network.create();

  // admin deploys the registry (so holds DEFAULT_ADMIN_ROLE);
  // verifier checks deeds; owner and buyer are ordinary users;
  // stranger has no role at all
  const [admin, verifier, owner, buyer, stranger] = await viem.getWalletClients();

  // Deploys the registry and gives `verifier` the VERIFIER_ROLE
  async function deployRegistry() {
    const registry = await viem.deployContract("PropertyRegistry", [], { client: { wallet: admin } });
    const VERIFIER_ROLE = await registry.read.VERIFIER_ROLE();
    await registry.write.grantRole([VERIFIER_ROLE, verifier.account.address], { account: admin.account });
    return { registry, VERIFIER_ROLE };
  }

  // Also: `owner` requests deed A (request #0), and the verifier approves it (NFT #0)
  async function deployWithOneProperty() {
    const { registry, VERIFIER_ROLE } = await deployRegistry();
    await registry.write.requestRegistration([DEED_A, SAMPLE_CID], { account: owner.account });
    await registry.write.approveRegistration([0n], { account: verifier.account });
    return { registry, VERIFIER_ROLE };
  }

  // ===========================================================================
  // ROLES
  // ===========================================================================

  it("makes the deployer the admin, and the admin can appoint verifiers", async function () {
    const { registry, VERIFIER_ROLE } = await networkHelpers.loadFixture(deployRegistry);
    const ADMIN_ROLE = await registry.read.DEFAULT_ADMIN_ROLE();

    // hasRole: AccessControl's free check, "does this address hold this role?"
    assert.equal(await registry.read.hasRole([ADMIN_ROLE, admin.account.address]), true);
    assert.equal(await registry.read.hasRole([VERIFIER_ROLE, verifier.account.address]), true);
    assert.equal(await registry.read.hasRole([VERIFIER_ROLE, stranger.account.address]), false);
  });

  // SECURITY: only the admin hands out roles
  it("does not let a non-admin make themselves a verifier", async function () {
    const { registry, VERIFIER_ROLE } = await networkHelpers.loadFixture(deployRegistry);
    const ADMIN_ROLE = await registry.read.DEFAULT_ADMIN_ROLE();

    // OpenZeppelin's error: (who tried, which role they'd need)
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.grantRole([VERIFIER_ROLE, stranger.account.address], { account: stranger.account }),
      registry,
      "AccessControlUnauthorizedAccount",
      [getAddress(stranger.account.address), ADMIN_ROLE],
    );
  });

  it("lets the admin remove a verifier", async function () {
    const { registry, VERIFIER_ROLE } = await networkHelpers.loadFixture(deployRegistry);
    await registry.write.revokeRole([VERIFIER_ROLE, verifier.account.address], { account: admin.account });
    assert.equal(await registry.read.hasRole([VERIFIER_ROLE, verifier.account.address]), false);
  });

  // ===========================================================================
  // STEP 1: REQUESTING REGISTRATION
  // ===========================================================================

  it("lets anyone request registration, but mints nothing yet", async function () {
    const { registry } = await networkHelpers.loadFixture(deployRegistry);

    await viem.assertions.emitWithArgs(
      registry.write.requestRegistration([DEED_A, SAMPLE_CID], { account: owner.account }),
      registry,
      "RegistrationRequested",
      [0n, getAddress(owner.account.address), DEED_A, SAMPLE_CID],
    );

    const request = await registry.read.getRequest([0n]);
    assert.equal(request.status, RequestStatus.Pending);
    assert.equal(getAddress(request.applicant), getAddress(owner.account.address));

    // No NFT and no registered deed until a verifier approves
    assert.equal(await registry.read.totalProperties(), 0n);
    assert.equal(await registry.read.isDeedRegistered([DEED_A]), false);
  });

  it("rejects requests with an empty deed hash or no metadata", async function () {
    const { registry } = await networkHelpers.loadFixture(deployRegistry);
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.requestRegistration([zeroHash, SAMPLE_CID], { account: owner.account }),
      registry,
      "InvalidProperty",
      ["Deed hash is required"],
    );
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.requestRegistration([DEED_A, ""], { account: owner.account }),
      registry,
      "InvalidProperty",
      ["Metadata CID is required"],
    );
  });

  it("rejects a request for a deed that's already registered", async function () {
    const { registry } = await networkHelpers.loadFixture(deployWithOneProperty);
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.requestRegistration([DEED_A, SAMPLE_CID], { account: stranger.account }),
      registry,
      "DeedAlreadyRegistered",
      [DEED_A],
    );
  });

  // ===========================================================================
  // STEP 2: THE VERIFIER DECIDES
  // ===========================================================================

  it("mints the NFT to the APPLICANT when a verifier approves", async function () {
    const { registry } = await networkHelpers.loadFixture(deployRegistry);
    await registry.write.requestRegistration([DEED_A, SAMPLE_CID], { account: owner.account });

    await viem.assertions.emitWithArgs(
      registry.write.approveRegistration([0n], { account: verifier.account }),
      registry,
      "RegistrationApproved",
      [0n, 0n, getAddress(verifier.account.address)],
    );

    // The owner (not the verifier!) receives NFT #0
    assert.equal(getAddress(await registry.read.ownerOf([0n])), getAddress(owner.account.address));
    assert.equal(await registry.read.isDeedRegistered([DEED_A]), true);
    assert.equal(await registry.read.tokenURI([0n]), `ipfs://${SAMPLE_CID}`);

    // The request records who decided, and which NFT it became
    const request = await registry.read.getRequest([0n]);
    assert.equal(request.status, RequestStatus.Approved);
    assert.equal(getAddress(request.reviewedBy), getAddress(verifier.account.address));
    assert.equal(request.propertyId, 0n);
  });

  // SECURITY: the whole point of this milestone
  it("does not let anyone without the VERIFIER role approve, not even the applicant", async function () {
    const { registry, VERIFIER_ROLE } = await networkHelpers.loadFixture(deployRegistry);
    await registry.write.requestRegistration([DEED_A, SAMPLE_CID], { account: owner.account });

    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.approveRegistration([0n], { account: owner.account }),
      registry,
      "AccessControlUnauthorizedAccount",
      [getAddress(owner.account.address), VERIFIER_ROLE],
    );
    assert.equal(await registry.read.totalProperties(), 0n);
  });

  it("lets a verifier reject a request, with a public reason", async function () {
    const { registry } = await networkHelpers.loadFixture(deployRegistry);
    await registry.write.requestRegistration([DEED_A, SAMPLE_CID], { account: owner.account });

    await viem.assertions.emitWithArgs(
      registry.write.rejectRegistration([0n, "Deed not found at the Lands Commission"], {
        account: verifier.account,
      }),
      registry,
      "RegistrationRejected",
      [0n, getAddress(verifier.account.address), "Deed not found at the Lands Commission"],
    );
    assert.equal((await registry.read.getRequest([0n])).status, RequestStatus.Rejected);
    assert.equal(await registry.read.totalProperties(), 0n);
  });

  it("can't decide the same request twice", async function () {
    const { registry } = await networkHelpers.loadFixture(deployWithOneProperty);
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.rejectRegistration([0n, "too late"], { account: verifier.account }),
      registry,
      "RequestNotPending",
      [0n, RequestStatus.Approved],
    );
  });

  it("when two people request the same deed, only the first approval wins", async function () {
    const { registry } = await networkHelpers.loadFixture(deployRegistry);
    // The real owner AND a scammer both request deed A
    await registry.write.requestRegistration([DEED_A, SAMPLE_CID], { account: owner.account }); // #0
    await registry.write.requestRegistration([DEED_A, SAMPLE_CID], { account: stranger.account }); // #1

    // The verifier checks and approves the real owner…
    await registry.write.approveRegistration([0n], { account: verifier.account });

    // …and now the scammer's request can never be approved
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.approveRegistration([1n], { account: verifier.account }),
      registry,
      "DeedAlreadyRegistered",
      [DEED_A],
    );
  });

  it("reports RequestNotFound for a request that doesn't exist", async function () {
    const { registry } = await networkHelpers.loadFixture(deployRegistry);
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.approveRegistration([5n], { account: verifier.account }),
      registry,
      "RequestNotFound",
      [5n],
    );
  });

  // ===========================================================================
  // THE NFT ITSELF (unchanged ERC-721 behaviour)
  // ===========================================================================

  it("keeps the standard NFT name, symbol and numbering", async function () {
    const { registry } = await networkHelpers.loadFixture(deployWithOneProperty);
    assert.equal(await registry.read.name(), "LinXar Property");
    assert.equal(await registry.read.symbol(), "LXP");

    await registry.write.requestRegistration([DEED_B, SAMPLE_CID], { account: buyer.account });
    await registry.write.approveRegistration([1n], { account: verifier.account });
    assert.equal(await registry.read.totalProperties(), 2n);
    assert.equal(getAddress(await registry.read.ownerOf([1n])), getAddress(buyer.account.address));
  });

  it("lets the owner transfer the NFT, and nobody else", async function () {
    const { registry } = await networkHelpers.loadFixture(deployWithOneProperty);

    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.transferFrom([owner.account.address, stranger.account.address, 0n], {
        account: stranger.account,
      }),
      registry,
      "ERC721InsufficientApproval",
      [getAddress(stranger.account.address), 0n],
    );

    // Note: not even the ADMIN or a VERIFIER can move someone's property
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.transferFrom([owner.account.address, admin.account.address, 0n], { account: admin.account }),
      registry,
      "ERC721InsufficientApproval",
      [getAddress(admin.account.address), 0n],
    );

    await registry.write.transferFrom([owner.account.address, buyer.account.address, 0n], { account: owner.account });
    assert.equal(getAddress(await registry.read.ownerOf([0n])), getAddress(buyer.account.address));
  });
});
