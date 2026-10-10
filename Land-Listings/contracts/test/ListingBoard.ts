// =============================================================================
// Tests for ListingBoard.sol (version 2)
// =============================================================================
// Each test deploys a fresh contract onto a private, in-memory blockchain,
// calls its functions, and checks the results. Nothing here touches a real
// network or costs real money.
//
// Run with:  npm run test   (or: npx hardhat test)
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, getAddress, keccak256, toBytes } from "viem";


// -----------------------------------------------------------------------------
// Enum values, matching the order in the contract.
// Solidity stores enums as small numbers: the first option is 0, the next 1…
// Naming them here makes the tests readable: Category.Land instead of 3.
// -----------------------------------------------------------------------------
const ListingType = { Sale: 0, Rent: 1, Lease: 2 } as const;
const Category = { Residential: 0, Commercial: 1, Industrial: 2, Land: 3 } as const;
const Status = { Available: 0, UnderOffer: 1, Rented: 2, Sold: 3, Withdrawn: 4 } as const;
const PricePeriod = { OneOff: 0, PerMonth: 1, PerYear: 2 } as const;

// An example IPFS fingerprint. The contract only stores it; it doesn't check
// that a real file exists. (On the website, real uploads produce real CIDs.)
const SAMPLE_CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

// The shape of the contract's NewListing struct, as viem expects it.
// uint256 → bigint, uint8/uint32 (enums, sizeSqm) → number.
type NewListingInput = {
  propertyId: bigint;
  listingType: number;
  category: number;
  pricePeriod: number;
  priceWei: bigint;
  sizeSqm: number;
  region: string;
  metadataCID: string;
};

// A valid example listing. Tests can change individual fields with
// `overrides`, e.g. newListing({ priceWei: 0n }) to test a zero price.
function newListing(overrides: Partial<NewListingInput> = {}): NewListingInput {
  return {
    propertyId: 0n, // property #0, which the fixture registers for `seller`
    listingType: ListingType.Sale,
    category: Category.Land,
    pricePeriod: PricePeriod.OneOff,
    priceWei: parseEther("5"), // 5 ETH, in wei
    sizeSqm: 500,
    region: "Greater Accra",
    metadataCID: SAMPLE_CID,
    ...overrides,
  };
}

describe("ListingBoard v2", async function () {
  // A brand-new simulated blockchain, just for these tests.
  const { viem, networkHelpers } = await network.create();

  // Two of the 20 test accounts: think of them as two different people.
  const [seller, stranger] = await viem.getWalletClients();

  // Fixture: deploys a fresh contract. `loadFixture` snapshots the chain after
  // the first run and rewinds to it before each test, so every test starts clean.
  // Deploys BOTH contracts, wired together, and registers property #0 for `seller`.
  async function deployListingBoard() {
    const registry = await viem.deployContract("PropertyRegistry");
    // The constructor argument goes in an array: the registry's address
    const listingBoard = await viem.deployContract("ListingBoard", [registry.address]);
    await registry.write.registerProperty([keccak256(toBytes("GA-12345-2019")), SAMPLE_CID], {
      account: seller.account,
    });
    return { listingBoard, registry };
  }

  // A second fixture that also creates one listing (id 0) owned by `seller`.
  // Many tests need an existing listing to work with.
 // Same, plus one listing (id 0) for that property
  async function deployWithOneListing() {
    const { listingBoard, registry } = await deployListingBoard();
    await listingBoard.write.createListing([newListing()], { account: seller.account });
    return { listingBoard, registry };
  }
  // ===========================================================================
  // CREATING LISTINGS
  // ===========================================================================

  it("starts with zero listings", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);
    assert.equal(await listingBoard.read.totalListings(), 0n);
  });

  it("creates a listing and stores every field", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);

    // The struct argument is passed as a JavaScript object. viem matches the
    // keys to the struct's field names using the ABI.
    await listingBoard.write.createListing(
      [newListing({ listingType: ListingType.Rent, pricePeriod: PricePeriod.PerMonth })],
      { account: seller.account },
    );

    const listing = await listingBoard.read.getListing([0n]);

    assert.equal(listing.id, 0n);
    assert.equal(getAddress(listing.owner), getAddress(seller.account.address)); // from msg.sender
    assert.equal(listing.listingType, ListingType.Rent);
    assert.equal(listing.category, Category.Land);
    assert.equal(listing.status, Status.Available); // every new listing starts Available
    assert.equal(listing.pricePeriod, PricePeriod.PerMonth);
    assert.equal(listing.priceWei, parseEther("5"));
    assert.equal(listing.sizeSqm, 500);
    assert.equal(listing.region, "Greater Accra");
    assert.equal(listing.metadataCID, SAMPLE_CID);

    // block.timestamp was recorded. On a new listing, created = updated.
    assert.ok(listing.createdAt > 0n);
    assert.equal(listing.updatedAt, listing.createdAt);
  });

  it("emits ListingCreated with all the filterable fields", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);

    // Arguments in the same order as the event declaration:
    // (id, owner, category, listingType, pricePeriod, priceWei, sizeSqm, region, metadataCID)
    await viem.assertions.emitWithArgs(
      listingBoard.write.createListing([newListing()], { account: seller.account }),
      listingBoard,
      "ListingCreated",
           [
        0n,
        getAddress(seller.account.address),
        0n, // ← propertyId
        Category.Land,
        ListingType.Sale,
        PricePeriod.OneOff,
        parseEther("5"),
        500,
        "Greater Accra",
        SAMPLE_CID,
      ],

    );
  });

  // ===========================================================================
  // INPUT VALIDATION: the contract rejects bad data
  // ===========================================================================
  // `revertWithCustomErrorWithArgs` checks that the transaction fails with a
  // specific CUSTOM ERROR, carrying specific values.

  it("rejects a listing with a zero price", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);
    await viem.assertions.revertWithCustomErrorWithArgs(
      listingBoard.write.createListing([newListing({ priceWei: 0n })]),
      listingBoard,
      "InvalidListing",
      ["Price must be more than zero"],
    );
  });

  it("rejects a listing without a metadata CID", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);
    await viem.assertions.revertWithCustomErrorWithArgs(
      listingBoard.write.createListing([newListing({ metadataCID: "" })]),
      listingBoard,
      "InvalidListing",
      ["Metadata CID is required"],
    );
  });

  it("rejects a listing without a region", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);
    await viem.assertions.revertWithCustomErrorWithArgs(
      listingBoard.write.createListing([newListing({ region: "" })]),
      listingBoard,
      "InvalidListing",
      ["Region is required"],
    );
  });

  // ===========================================================================
  // UPDATING LISTINGS
  // ===========================================================================

  it("lets the owner update price, period, size and details", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployWithOneListing);
    const before = await listingBoard.read.getListing([0n]);

    // Move the chain's clock forward 1 hour, so we can see updatedAt change.
    await networkHelpers.time.increase(3600);

    const NEW_CID = "bafkreiexamplenewdetailsversion2";
    await viem.assertions.emitWithArgs(
      listingBoard.write.updateListing([0n, PricePeriod.PerYear, parseEther("4"), 450, NEW_CID], {
        account: seller.account,
      }),
      listingBoard,
      "ListingUpdated",
      [0n, PricePeriod.PerYear, parseEther("4"), 450, NEW_CID],
    );

    const after = await listingBoard.read.getListing([0n]);
    assert.equal(after.pricePeriod, PricePeriod.PerYear);
    assert.equal(after.priceWei, parseEther("4"));
    assert.equal(after.sizeSqm, 450);
    assert.equal(after.metadataCID, NEW_CID);
    assert.ok(after.updatedAt > before.updatedAt); // timestamp moved forward
    assert.equal(after.createdAt, before.createdAt); // creation time never changes
  });

  // SECURITY: contracts are public, so anyone can call updateListing.
  // Only the `onlyListingOwner` modifier stops strangers editing your listing.
  it("does not let a stranger update someone else's listing", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployWithOneListing);

    // The error carries WHICH listing and WHO tried: (id, caller)
    await viem.assertions.revertWithCustomErrorWithArgs(
      listingBoard.write.updateListing([0n, PricePeriod.OneOff, 1n, 1, "hacked"], {
        account: stranger.account,
      }),
      listingBoard,
      "NotListingOwner",
      [0n, getAddress(stranger.account.address)],
    );

    // The transaction reverted, so nothing changed.
    const listing = await listingBoard.read.getListing([0n]);
    assert.equal(listing.metadataCID, SAMPLE_CID);
  });

  it("still validates the price when updating", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployWithOneListing);
    await viem.assertions.revertWithCustomErrorWithArgs(
      listingBoard.write.updateListing([0n, PricePeriod.OneOff, 0n, 500, SAMPLE_CID], {
        account: seller.account,
      }),
      listingBoard,
      "InvalidListing",
      ["Price must be more than zero"],
    );
  });

  // ===========================================================================
  // STATUS
  // ===========================================================================

  it("lets the owner change the status", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployWithOneListing);

    await viem.assertions.emitWithArgs(
      listingBoard.write.setStatus([0n, Status.Rented], { account: seller.account }),
      listingBoard,
      "ListingStatusChanged",
      [0n, Status.Rented],
    );

    assert.equal((await listingBoard.read.getListing([0n])).status, Status.Rented);
  });

  // SECURITY: a stranger must not be able to mark your property as Sold
  // or Withdrawn.
  it("does not let a stranger change someone else's status", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployWithOneListing);

    await viem.assertions.revertWithCustomErrorWithArgs(
      listingBoard.write.setStatus([0n, Status.Withdrawn], { account: stranger.account }),
      listingBoard,
      "NotListingOwner",
      [0n, getAddress(stranger.account.address)],
    );

    assert.equal((await listingBoard.read.getListing([0n])).status, Status.Available);
  });

  it("reports ListingNotFound for an id that doesn't exist", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployWithOneListing);

    // Only listing 0 exists, so listing 7 doesn't.
    await viem.assertions.revertWithCustomErrorWithArgs(
      listingBoard.write.setStatus([7n, Status.Sold], { account: seller.account }),
      listingBoard,
      "ListingNotFound",
      [7n],
    );
  });


    // ===========================================================================
  // PROPERTY OWNERSHIP: the anti-fraud check
  // ===========================================================================

  // SECURITY: you can't list a property you don't own
  it("does not let a stranger list someone else's property", async function () {
    const { listingBoard } = await networkHelpers.loadFixture(deployListingBoard);

    await viem.assertions.revertWithCustomErrorWithArgs(
      listingBoard.write.createListing([newListing()], { account: stranger.account }),
      listingBoard,
      "NotAuthorizedForProperty",
      [0n, getAddress(stranger.account.address)],
    );
    assert.equal(await listingBoard.read.totalListings(), 0n);
  });

  it("lets an agent the owner approved list the property", async function () {
    const { listingBoard, registry } = await networkHelpers.loadFixture(deployListingBoard);
    const agent = stranger;

    // The owner approves the agent for ALL their properties (standard ERC-721)
    await registry.write.setApprovalForAll([agent.account.address, true], { account: seller.account });

    await listingBoard.write.createListing([newListing()], { account: agent.account });
    const listing = await listingBoard.read.getListing([0n]);
    assert.equal(getAddress(listing.owner), getAddress(agent.account.address)); // the agent manages it
    assert.equal(listing.propertyId, 0n);
  });

  it("rejects a listing for a property that was never registered", async function () {
    const { listingBoard, registry } = await networkHelpers.loadFixture(deployListingBoard);

    // Property #99 doesn't exist, so when ListingBoard asks the registry
    // ownerOf(99), the REGISTRY reverts with OpenZeppelin's custom error
    // ERC721NonexistentToken(99), and that revert stops createListing too.
    // We pass `registry` (not listingBoard) because the error is defined in
    // the registry's ABI: that's how viem knows how to decode it.
    await viem.assertions.revertWithCustomErrorWithArgs(
      listingBoard.write.createListing([newListing({ propertyId: 99n })], { account: seller.account }),
      registry,
      "ERC721NonexistentToken",
      [99n],
    );
  });

});
