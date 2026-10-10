// =============================================================================
// Tests for PropertyRegistry.sol: properties as NFTs
// =============================================================================
// Run with:  npm run test   (runs these AND the ListingBoard tests)
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, keccak256, toBytes, zeroHash } from "viem";

// -----------------------------------------------------------------------------
// DEED HASHES
// -----------------------------------------------------------------------------
// The contract never stores the deed number itself, only its keccak256 hash:
// a 32-byte fingerprint. The same text ALWAYS gives the same hash, so if
// someone tries to register the same deed again, the hashes match and the
// contract rejects it.
// (In the website we'll tidy the number first, e.g. remove spaces and use
// capitals, so "ga-12345 " and "GA-12345" count as the same deed.)
function deedHash(deedNumber: string) {
  return keccak256(toBytes(deedNumber));
}

const DEED_A = deedHash("GA-12345-2019");
const DEED_B = deedHash("AS-67890-2021");
const SAMPLE_CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

describe("PropertyRegistry", async function () {
  const { viem, networkHelpers } = await network.create();

  // Three people: the property owner, a buyer, and a stranger
  const [owner, buyer, stranger] = await viem.getWalletClients();

  async function deployRegistry() {
    const registry = await viem.deployContract("PropertyRegistry");
    return { registry };
  }

  // Also registers one property (token #0, deed A) owned by `owner`
  async function deployWithOneProperty() {
    const registry = await viem.deployContract("PropertyRegistry");
    await registry.write.registerProperty([DEED_A, SAMPLE_CID], { account: owner.account });
    return { registry };
  }

  // ===========================================================================
  // THE NFT BASICS
  // ===========================================================================

  it("has the NFT name and symbol we chose", async function () {
    const { registry } = await networkHelpers.loadFixture(deployRegistry);
    // name() and symbol() come from OpenZeppelin's ERC721; we wrote neither
    assert.equal(await registry.read.name(), "LinXar Property");
    assert.equal(await registry.read.symbol(), "LXP");
  });

  it("registers a property and gives the NFT to the sender", async function () {
    const { registry } = await networkHelpers.loadFixture(deployWithOneProperty);

    // ownerOf: the standard ERC-721 question "who owns token #0?"
    assert.equal(getAddress(await registry.read.ownerOf([0n])), getAddress(owner.account.address));

    // balanceOf: "how many of these NFTs does this address own?"
    assert.equal(await registry.read.balanceOf([owner.account.address]), 1n);

    assert.equal(await registry.read.totalProperties(), 1n);
    assert.equal(await registry.read.isDeedRegistered([DEED_A]), true);
    assert.equal(await registry.read.isDeedRegistered([DEED_B]), false);

    const property = await registry.read.getProperty([0n]);
    assert.equal(property.deedHash, DEED_A);
    assert.equal(property.metadataCID, SAMPLE_CID);
    assert.ok(property.registeredAt > 0n);

    // tokenURI is how wallets and marketplaces find the NFT's details
    assert.equal(await registry.read.tokenURI([0n]), `ipfs://${SAMPLE_CID}`);
  });

  it("emits PropertyRegistered", async function () {
    const { registry } = await networkHelpers.loadFixture(deployRegistry);
    await viem.assertions.emitWithArgs(
      registry.write.registerProperty([DEED_A, SAMPLE_CID], { account: owner.account }),
      registry,
      "PropertyRegistered",
      [0n, getAddress(owner.account.address), DEED_A, SAMPLE_CID],
    );
  });

  it("gives each new property the next token id", async function () {
    const { registry } = await networkHelpers.loadFixture(deployWithOneProperty);
    await registry.write.registerProperty([DEED_B, SAMPLE_CID], { account: buyer.account });

    assert.equal(await registry.read.totalProperties(), 2n);
    assert.equal(getAddress(await registry.read.ownerOf([1n])), getAddress(buyer.account.address));
  });

  // ===========================================================================
  // THE ANTI-FRAUD RULE: one deed, one registration
  // ===========================================================================

  it("rejects registering the same deed twice, even by someone else", async function () {
    const { registry } = await networkHelpers.loadFixture(deployWithOneProperty);

    // A stranger tries to register deed A again, e.g. to "sell" the plot
    // a second time. The contract refuses, and says which deed it was.
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.registerProperty([DEED_A, SAMPLE_CID], { account: stranger.account }),
      registry,
      "DeedAlreadyRegistered",
      [DEED_A],
    );

    // Still only one property, still owned by the original owner
    assert.equal(await registry.read.totalProperties(), 1n);
    assert.equal(getAddress(await registry.read.ownerOf([0n])), getAddress(owner.account.address));
  });

  it("rejects an empty deed hash", async function () {
    const { registry } = await networkHelpers.loadFixture(deployRegistry);
    // zeroHash = 0x000…000, the "empty" value of a bytes32
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.registerProperty([zeroHash, SAMPLE_CID]),
      registry,
      "InvalidProperty",
      ["Deed hash is required"],
    );
  });

  it("rejects a property without metadata", async function () {
    const { registry } = await networkHelpers.loadFixture(deployRegistry);
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.registerProperty([DEED_A, ""]),
      registry,
      "InvalidProperty",
      ["Metadata CID is required"],
    );
  });

  // ===========================================================================
  // TRANSFERS: what happens when a property is sold
  // ===========================================================================
  // We didn't write any transfer code. These functions come from
  // OpenZeppelin's ERC721, and these tests show that they work as expected.

  it("lets the owner transfer the NFT to a buyer", async function () {
    const { registry } = await networkHelpers.loadFixture(deployWithOneProperty);

    // The standard ERC-721 Transfer event: (from, to, tokenId)
    await viem.assertions.emitWithArgs(
      registry.write.transferFrom([owner.account.address, buyer.account.address, 0n], {
        account: owner.account,
      }),
      registry,
      "Transfer",
      [getAddress(owner.account.address), getAddress(buyer.account.address), 0n],
    );

    // The buyer now owns the on-chain record
    assert.equal(getAddress(await registry.read.ownerOf([0n])), getAddress(buyer.account.address));
    assert.equal(await registry.read.balanceOf([owner.account.address]), 0n);
  });

  // SECURITY: nobody can take someone else's property NFT
  it("does not let a stranger transfer someone else's property", async function () {
    const { registry } = await networkHelpers.loadFixture(deployWithOneProperty);

    // OpenZeppelin's own custom error: (who tried, which token)
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.transferFrom([owner.account.address, stranger.account.address, 0n], {
        account: stranger.account,
      }),
      registry,
      "ERC721InsufficientApproval",
      [getAddress(stranger.account.address), 0n],
    );

    assert.equal(getAddress(await registry.read.ownerOf([0n])), getAddress(owner.account.address));
  });

  // An owner can APPROVE someone (e.g. their agent) to move one specific NFT
  it("lets an approved agent transfer the property", async function () {
    const { registry } = await networkHelpers.loadFixture(deployWithOneProperty);
    const agent = stranger; // reuse the third account as an agent

    await registry.write.approve([agent.account.address, 0n], { account: owner.account });
    assert.equal(getAddress(await registry.read.getApproved([0n])), getAddress(agent.account.address));

    // The agent moves it to the buyer on the owner's behalf
    await registry.write.transferFrom([owner.account.address, buyer.account.address, 0n], {
      account: agent.account,
    });
    assert.equal(getAddress(await registry.read.ownerOf([0n])), getAddress(buyer.account.address));
  });

  it("reports ERC721NonexistentToken for a property that doesn't exist", async function () {
    const { registry } = await networkHelpers.loadFixture(deployWithOneProperty);
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.transferFrom([owner.account.address, buyer.account.address, 99n], {
        account: owner.account,
      }),
      registry,
      "ERC721NonexistentToken",
      [99n],
    );
  });
});
