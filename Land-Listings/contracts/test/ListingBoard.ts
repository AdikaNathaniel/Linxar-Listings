// =============================================================================
// Tests for ListingBoard.sol
// =============================================================================
// A test file deploys the contract onto a fresh, simulated blockchain that
// Hardhat creates in memory, calls its functions, and checks that the results
// are what we expect. Nothing here touches a real network or costs real money.
//
// Run with:  npx hardhat test
// =============================================================================

// `describe` groups related tests together; `it` defines one single test.
// Both come from Node.js's built-in test runner, so nothing extra to install.
import { describe, it } from "node:test";

// `assert` is how a test says "this MUST be true". If an assertion fails,
// the test fails and Hardhat prints what was expected vs. what it got.
import assert from "node:assert/strict";

// `network` is Hardhat's entry point for creating a blockchain to test on.
import { network } from "hardhat";

// `parseEther` converts a human-friendly ETH amount ("2") into wei
// (2000000000000000000n). `getAddress` normalises an address's
// capital letters so two addresses can be compared reliably.
import { parseEther, getAddress } from "viem";

describe("ListingBoard", async function () {
  // ---------------------------------------------------------------------------
  // SETUP: create a private test blockchain
  // ---------------------------------------------------------------------------
  // `network.create()` starts a brand-new simulated Ethereum network that
  // exists only while these tests run. It gives us two helpers:
  //   - viem:           tools to deploy contracts, send transactions, read data
  //   - networkHelpers: tools to control the test chain (snapshots, time, ...)
  const { viem, networkHelpers } = await network.create();

  // The test network comes with 20 funded accounts (wallets). We take two:
  //   - seller: will create listings (plays the property owner / agent)
  //   - stranger: someone else, used to check they CAN'T touch the seller's listing
  // These are like two different people, each with their own MetaMask.
  const [seller, stranger] = await viem.getWalletClients();

  // ---------------------------------------------------------------------------
  // FIXTURE: a fresh copy of the contract for every test
  // ---------------------------------------------------------------------------
  // A "fixture" is a setup function. `loadFixture` runs it once, takes a 
  // snapshot of the blockchain, and then rewinds to that snapshot before each
  // test. Every test therefore starts with a clean, just-deployed contract and
  // no listings, so tests can never affect each other.
  // (It must be a named function, not an arrow function, for caching to work.)
  async function deployListingBoard() {
    // Deploys ListingBoard.sol to the test chain. This is a real deployment
    // transaction, sent from the first account (`seller`) by default.
    // The returned object is "typed": it knows every function in the contract
    // from the ABI, so typos in function names are caught before running.
    const listingBoard = await viem.deployContract("ListingBoard");
    return { listingBoard };
  }

  // ---------------------------------------------------------------------------
  // TEST 1: a brand-new contract has no listings
  // ---------------------------------------------------------------------------
  it("starts with zero listings", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);

    // `.read.` calls a `view` function. Reads are free: no transaction,
    // no gas, no signature. Solidity's uint256 comes back as a JavaScript
    // BigInt, which is why we compare to `0n` (the "n" means BigInt).
    const total = await listingBoard.read.totalListings();

    assert.equal(total, 0n);
  });

  // ---------------------------------------------------------------------------
  // TEST 2: creating a listing stores every field correctly
  // ---------------------------------------------------------------------------
  it("creates a listing and stores all its details", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);

    const price = parseEther("2"); // 2 ETH, expressed in wei

    // `.write.` sends a TRANSACTION, because createListing changes the
    // blockchain's state. On a real network this is the moment MetaMask would
    // pop up asking the user to sign and pay gas.
    // The function's arguments go inside an array, in the same order as in
    // Solidity: (title, location, priceWei).
    // `account: seller.account` says WHO signs it. Inside the contract,
    // this account becomes `msg.sender`.
    await listingBoard.write.createListing(
      ["3-bedroom house", "East Legon, Accra", price],
      { account: seller.account },
    );

    // There should now be exactly one listing.
    assert.equal(await listingBoard.read.totalListings(), 1n);

    // Read it back. The first listing has id 0, because arrays start at 0.
    // viem returns the Solidity struct as a JavaScript object, with the same
    // field names as the `Listing` struct.
    const listing = await listingBoard.read.getListing([0n]);

    assert.equal(listing.id, 0n);
    assert.equal(listing.title, "3-bedroom house");
    assert.equal(listing.location, "East Legon, Accra");
    assert.equal(listing.priceWei, price);
    assert.equal(listing.active, true); // new listings start active

    // The most important check: the contract recorded the SIGNER as the owner.
    // It got this from `msg.sender`, not from anything the caller typed in,
    // so nobody can create a listing in someone else's name.
    assert.equal(getAddress(listing.owner), getAddress(seller.account.address));
  });

  // ---------------------------------------------------------------------------
  // TEST 3: each new listing gets the next id
  // ---------------------------------------------------------------------------
  it("gives each new listing the next id", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);

    await listingBoard.write.createListing(["Plot of land", "Tema", parseEther("5")]);
    await listingBoard.write.createListing(["Office space", "Osu, Accra", parseEther("1")]);

    // Two listings → ids 0 and 1, and the total is 2.
    assert.equal(await listingBoard.read.totalListings(), 2n);
    assert.equal((await listingBoard.read.getListing([1n])).title, "Office space");
  });

  // ---------------------------------------------------------------------------
  // TEST 4: the owner can deactivate their own listing
  // ---------------------------------------------------------------------------
  it("lets the owner deactivate their listing", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);

    await listingBoard.write.createListing(
      ["Shop", "Kumasi", parseEther("3")],
      { account: seller.account },
    );

    // Same account that created it, so the `require` check in the contract
    // (owner == msg.sender) passes.
    await listingBoard.write.deactivateListing([0n], { account: seller.account });

    // The listing still exists (blockchain history isn't deleted),
    // but it's now marked inactive.
    const listing = await listingBoard.read.getListing([0n]);
    assert.equal(listing.active, false);
  });

  // ---------------------------------------------------------------------------
  // TEST 5 (SECURITY): a stranger CANNOT deactivate someone else's listing
  // ---------------------------------------------------------------------------
  // This is the most important test in the file. Contracts are public: anyone
  // in the world can call any function. The only thing stopping a stranger
  // from removing your listing is the `require` line in the contract.
  // This test proves that line works.
  it("does not let a stranger deactivate someone else's listing", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);

    await listingBoard.write.createListing(
      ["Warehouse", "Takoradi", parseEther("4")],
      { account: seller.account },
    );

    // The stranger tries to deactivate the seller's listing.
    // `revertWith` expects the transaction to FAIL ("revert") with exactly
    // the message written in the contract's require: "Not your listing".
    // Note: no `await` before listingBoard.write here. We hand the pending
    // transaction to revertWith, and it waits for it and checks the failure.
    await viem.assertions.revertWith(
      listingBoard.write.deactivateListing([0n], { account: stranger.account }),
      "Not your listing",
    );

    // And because the transaction reverted, NOTHING changed:
    // the listing is still active.
    const listing = await listingBoard.read.getListing([0n]);
    assert.equal(listing.active, true);
  });
});
