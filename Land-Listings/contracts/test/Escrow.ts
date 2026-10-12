// =============================================================================
// Tests for Escrow.sol: holding money safely until a deal is done
// =============================================================================
// These tests deploy all THREE contracts (PropertyRegistry, ListingBoard,
// Escrow), wire them together, and walk through every path a deal can take:
// the happy paths, the refunds, the disputes, the deadline, and an attack.
//
// Run with:  npm run test
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, getAddress, keccak256, toBytes } from "viem";

// Enum values, matching the order in the contracts
const ListingType = { Sale: 0, Rent: 1, Lease: 2 } as const;
const ListingStatus = { Available: 0, UnderOffer: 1, Rented: 2, Sold: 3, Withdrawn: 4 } as const;
const PricePeriod = { OneOff: 0, PerMonth: 1, PerYear: 2 } as const;
const DealKind = { Purchase: 0, RentalDeposit: 1 } as const;
const DealStatus = { Funded: 0, Accepted: 1, Completed: 2, Refunded: 3, Disputed: 4 } as const;

const SAMPLE_CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
const SALE_PRICE = parseEther("3");
const SEVEN_DAYS = 7 * 24 * 60 * 60; // in seconds

describe("Escrow", async function () {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();

  // Four people:
  //   arbiter  - the trusted dispute-resolver (also deploys the contracts)
  //   seller   - owns two properties and lists them
  //   buyer    - makes offers
  //   stranger - someone with no part in the deal
  const [arbiter, seller, buyer, stranger] = await viem.getWalletClients();

  // ---------------------------------------------------------------------------
  // FIXTURE: the whole LinXar system, with two listings ready to deal on
  //   listing #0: property #0 FOR SALE at 3 ETH
  //   listing #1: property #1 FOR RENT at 0.2 ETH / month
  // ---------------------------------------------------------------------------
  async function deployLinXar() {
    // `arbiter` is the first account, so it deploys everything and is ADMIN of each contract
    const registry = await viem.deployContract("PropertyRegistry");
    const board = await viem.deployContract("ListingBoard", [registry.address]);
    const escrow = await viem.deployContract("Escrow", [board.address, registry.address]);

    // Milestone 7: roles. The admin makes itself the escrow's ARBITER, and
    // (just for this setup) a property VERIFIER.
    await escrow.write.grantRole([await escrow.read.ARBITER_ROLE(), arbiter.account.address], {
      account: arbiter.account,
    });
    await registry.write.grantRole([await registry.read.VERIFIER_ROLE(), arbiter.account.address], {
      account: arbiter.account,
    });

    // The seller requests two properties and the verifier approves them
    // (the seller receives NFTs #0 and #1)…
    for (const [i, deed] of ["GA-1-2019", "GA-2-2020"].entries()) {
      await registry.write.requestRegistration([keccak256(toBytes(deed)), SAMPLE_CID], { account: seller.account });
      await registry.write.approveRegistration([BigInt(i)], { account: arbiter.account });
    }

    // …and lists them
    const listing = (propertyId: bigint, listingType: number, priceWei: bigint, pricePeriod: number) => ({
      propertyId,
      listingType,
      category: 0,
      pricePeriod,
      priceWei,
      sizeSqm: 200,
      region: "Greater Accra",
      metadataCID: SAMPLE_CID,
    });
    await board.write.createListing([listing(0n, ListingType.Sale, SALE_PRICE, PricePeriod.OneOff)], {
      account: seller.account,
    });
    await board.write.createListing([listing(1n, ListingType.Rent, parseEther("0.2"), PricePeriod.PerMonth)], {
      account: seller.account,
    });

    return { registry, board, escrow };
  }

  // The escrow contract's own ETH balance: the money it's holding
  async function escrowBalance(escrow: { address: `0x${string}` }) {
    return publicClient.getBalance({ address: escrow.address });
  }

  // ===========================================================================
  // 1. OPENING A DEAL: the buyer's money gets locked
  // ===========================================================================

  it("opens a purchase deal and locks the exact price in the escrow", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);

    // `value` is the ETH sent with the transaction: it arrives as msg.value
    await viem.assertions.emitWithArgs(
      escrow.write.openDeal([0n], { value: SALE_PRICE, account: buyer.account }),
      escrow,
      "DealOpened",
      [0n, 0n, getAddress(buyer.account.address), getAddress(seller.account.address), DealKind.Purchase, SALE_PRICE],
    );

    // The money is now held by the CONTRACT, not by the seller
    assert.equal(await escrowBalance(escrow), SALE_PRICE);

    const deal = await escrow.read.getDeal([0n]);
    assert.equal(deal.kind, DealKind.Purchase);
    assert.equal(deal.status, DealStatus.Funded);
    assert.equal(deal.amount, SALE_PRICE);
    assert.equal(deal.propertyId, 0n);
  });

  it("rejects a purchase that doesn't pay the exact price", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await viem.assertions.revertWithCustomErrorWithArgs(
      escrow.write.openDeal([0n], { value: parseEther("1"), account: buyer.account }),
      escrow,
      "WrongAmount",
      [SALE_PRICE, parseEther("1")],
    );
  });

  it("accepts any non-zero deposit on a rental listing", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([1n], { value: parseEther("0.4"), account: buyer.account }); // 2 months
    const deal = await escrow.read.getDeal([0n]);
    assert.equal(deal.kind, DealKind.RentalDeposit);
    assert.equal(deal.amount, parseEther("0.4"));
  });

  it("rejects a zero deposit", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await viem.assertions.revertWithCustomErrorWithArgs(
      escrow.write.openDeal([1n], { value: 0n, account: buyer.account }),
      escrow,
      "WrongAmount",
      [1n, 0n],
    );
  });

  it("does not let the seller open a deal on their own listing", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await viem.assertions.revertWithCustomError(
      escrow.write.openDeal([0n], { value: SALE_PRICE, account: seller.account }),
      escrow,
      "CannotBuyOwnListing",
    );
  });

  it("rejects deals on listings that aren't available", async function () {
    const { board, escrow } = await networkHelpers.loadFixture(deployLinXar);
    await board.write.setStatus([0n, ListingStatus.Sold], { account: seller.account });
    await viem.assertions.revertWithCustomErrorWithArgs(
      escrow.write.openDeal([0n], { value: SALE_PRICE, account: buyer.account }),
      escrow,
      "ListingNotAvailable",
      [0n],
    );
  });

  // ===========================================================================
  // 2. BEFORE ACCEPTANCE: either side can walk away; the buyer is refunded
  // ===========================================================================

  it("lets the buyer cancel and withdraw their money", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([0n], { value: SALE_PRICE, account: buyer.account });

    await viem.assertions.emit(escrow.write.cancelDeal([0n], { account: buyer.account }), escrow, "DealRefunded");
    assert.equal((await escrow.read.getDeal([0n])).status, DealStatus.Refunded);

    // PULL PAYMENT: cancelling only RECORDS what the buyer is owed…
    assert.equal(await escrow.read.pendingWithdrawals([buyer.account.address]), SALE_PRICE);
    assert.equal(await escrowBalance(escrow), SALE_PRICE); // …the ETH hasn't moved yet

    // …the ETH leaves the contract only when the buyer withdraws
    await viem.assertions.emitWithArgs(
      escrow.write.withdraw({ account: buyer.account }),
      escrow,
      "Withdrawal",
      [getAddress(buyer.account.address), SALE_PRICE],
    );
    assert.equal(await escrow.read.pendingWithdrawals([buyer.account.address]), 0n);
    assert.equal(await escrowBalance(escrow), 0n);
  });

  it("lets the seller reject an offer, refunding the buyer", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([0n], { value: SALE_PRICE, account: buyer.account });
    await escrow.write.rejectDeal([0n], { account: seller.account });
    assert.equal(await escrow.read.pendingWithdrawals([buyer.account.address]), SALE_PRICE);
  });

  // SECURITY: only the people in the deal can change it
  it("does not let a stranger cancel or reject someone else's deal", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([0n], { value: SALE_PRICE, account: buyer.account });

    for (const call of [
      escrow.write.cancelDeal([0n], { account: stranger.account }),
      escrow.write.rejectDeal([0n], { account: stranger.account }),
    ]) {
      await viem.assertions.revertWithCustomErrorWithArgs(call, escrow, "NotAllowed", [
        0n,
        getAddress(stranger.account.address),
      ]);
    }
  });

  // ===========================================================================
  // 3. THE HAPPY PATHS: money and property change hands
  // ===========================================================================

  it("won't let the seller accept a sale before approving the escrow to move the NFT", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([0n], { value: SALE_PRICE, account: buyer.account });

    // Without approval, the escrow couldn't hand over the property later,
    // so it refuses to let the seller accept now.
    await viem.assertions.revertWithCustomErrorWithArgs(
      escrow.write.acceptDeal([0n], { account: seller.account }),
      escrow,
      "EscrowNotApprovedForProperty",
      [0n],
    );
  });

  it("completes a sale: the seller gets paid AND the buyer gets the property NFT", async function () {
    const { registry, escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([0n], { value: SALE_PRICE, account: buyer.account });

    // The seller lets the escrow move their property NFTs (standard ERC-721)
    await registry.write.setApprovalForAll([escrow.address, true], { account: seller.account });
    await viem.assertions.emit(escrow.write.acceptDeal([0n], { account: seller.account }), escrow, "DealAccepted");

    // The buyer visits, checks the documents, and confirms
    await viem.assertions.emit(escrow.write.confirmDeal([0n], { account: buyer.account }), escrow, "DealCompleted");

    // THE ATOMIC SWAP: in that ONE transaction, both things happened:
    assert.equal(getAddress(await registry.read.ownerOf([0n])), getAddress(buyer.account.address)); // property → buyer
    assert.equal(await escrow.read.pendingWithdrawals([seller.account.address]), SALE_PRICE); // money → seller

    await escrow.write.withdraw({ account: seller.account });
    assert.equal(await escrowBalance(escrow), 0n);
  });

  it("completes a rental deposit: the landlord gets paid, and no NFT moves", async function () {
    const { registry, escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([1n], { value: parseEther("0.4"), account: buyer.account });

    // No NFT approval needed: renting doesn't transfer ownership
    await escrow.write.acceptDeal([0n], { account: seller.account });
    await escrow.write.confirmDeal([0n], { account: buyer.account });

    assert.equal(await escrow.read.pendingWithdrawals([seller.account.address]), parseEther("0.4"));
    assert.equal(getAddress(await registry.read.ownerOf([1n])), getAddress(seller.account.address)); // still the landlord's
  });

  // SECURITY: the state machine stops anything happening twice
  it("can't be completed twice", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([1n], { value: parseEther("0.4"), account: buyer.account });
    await escrow.write.acceptDeal([0n], { account: seller.account });
    await escrow.write.confirmDeal([0n], { account: buyer.account });

    // A second confirm, or a late cancel, is refused: the deal is Completed
    for (const call of [
      escrow.write.confirmDeal([0n], { account: buyer.account }),
      escrow.write.cancelDeal([0n], { account: buyer.account }),
    ]) {
      await viem.assertions.revertWithCustomErrorWithArgs(call, escrow, "WrongStatus", [0n, DealStatus.Completed]);
    }
  });

  it("does not let the buyer simply cancel after the seller accepted", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([1n], { value: parseEther("0.4"), account: buyer.account });
    await escrow.write.acceptDeal([0n], { account: seller.account });

    await viem.assertions.revertWithCustomErrorWithArgs(
      escrow.write.cancelDeal([0n], { account: buyer.account }),
      escrow,
      "WrongStatus",
      [0n, DealStatus.Accepted],
    );
  });

  // ===========================================================================
  // 4. THE 7-DAY WINDOW: protects the seller from a silent buyer
  // ===========================================================================

  it("lets the seller finalise only AFTER the buyer's 7-day window", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([1n], { value: parseEther("0.4"), account: buyer.account });
    await escrow.write.acceptDeal([0n], { account: seller.account });

    // Too early: the buyer still has time to confirm or dispute
    const { acceptedAt } = await escrow.read.getDeal([0n]);
    await viem.assertions.revertWithCustomErrorWithArgs(
      escrow.write.finalizeAfterTimeout([0n], { account: seller.account }),
      escrow,
      "ConfirmWindowStillOpen",
      [acceptedAt + BigInt(SEVEN_DAYS)],
    );

    // Fast-forward the test chain's clock past the window…
    await networkHelpers.time.increase(SEVEN_DAYS + 1);

    // …now the seller can complete the deal without the buyer
    await escrow.write.finalizeAfterTimeout([0n], { account: seller.account });
    assert.equal((await escrow.read.getDeal([0n])).status, DealStatus.Completed);
  });

  // ===========================================================================
  // 5. DISPUTES: only the arbiter decides
  // ===========================================================================

  it("lets the arbiter refund the buyer in a dispute", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([1n], { value: parseEther("0.4"), account: buyer.account });
    await escrow.write.acceptDeal([0n], { account: seller.account });

    await viem.assertions.emitWithArgs(
      escrow.write.raiseDispute([0n], { account: buyer.account }),
      escrow,
      "DealDisputed",
      [0n, getAddress(buyer.account.address)],
    );

    // Not even the seller (or anyone else) can settle it themselves: only
    // holders of ARBITER_ROLE can (Milestone 7: OpenZeppelin's role error)
    await viem.assertions.revertWithCustomErrorWithArgs(
      escrow.write.resolveDispute([0n, true], { account: seller.account }),
      escrow,
      "AccessControlUnauthorizedAccount",
      [getAddress(seller.account.address), await escrow.read.ARBITER_ROLE()],
    );

    // The arbiter rules for the buyer
    await escrow.write.resolveDispute([0n, false], { account: arbiter.account });
    assert.equal((await escrow.read.getDeal([0n])).status, DealStatus.Refunded);
    assert.equal(await escrow.read.pendingWithdrawals([buyer.account.address]), parseEther("0.4"));
  });

  it("lets the arbiter complete a disputed sale, moving the property", async function () {
    const { registry, escrow } = await networkHelpers.loadFixture(deployLinXar);
    await escrow.write.openDeal([0n], { value: SALE_PRICE, account: buyer.account });
    await registry.write.setApprovalForAll([escrow.address, true], { account: seller.account });
    await escrow.write.acceptDeal([0n], { account: seller.account });
    await escrow.write.raiseDispute([0n], { account: seller.account });

    await escrow.write.resolveDispute([0n, true], { account: arbiter.account });
    assert.equal(getAddress(await registry.read.ownerOf([0n])), getAddress(buyer.account.address));
    assert.equal(await escrow.read.pendingWithdrawals([seller.account.address]), SALE_PRICE);
  });

  // ===========================================================================
  // 6. WITHDRAWALS and the REENTRANCY ATTACK
  // ===========================================================================

  it("rejects a withdrawal when nothing is owed", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);
    await viem.assertions.revertWithCustomError(
      escrow.write.withdraw({ account: stranger.account }),
      escrow,
      "NothingToWithdraw",
    );
  });

  // SECURITY: the attack behind the 2016 DAO hack. It must fail.
  it("defeats a reentrancy attack: the attacker can't drain other people's money", async function () {
    const { escrow } = await networkHelpers.loadFixture(deployLinXar);

    // An honest buyer has 0.4 ETH locked in a rental deposit
    await escrow.write.openDeal([1n], { value: parseEther("0.4"), account: buyer.account });

    // The attacker contract opens its own deal (0.1 ETH), then cancels it,
    // so the escrow legitimately owes it 0.1 ETH
    const attacker = await viem.deployContract("ReentrancyAttacker", [escrow.address]);
    await attacker.write.openDeal([1n], { value: parseEther("0.1"), account: stranger.account });
    await attacker.write.cancel([1n], { account: stranger.account });
    assert.equal(await escrowBalance(escrow), parseEther("0.5"));

    // THE ATTACK: withdraw, and from inside receive(), withdraw again.
    // `nonReentrant` blocks the second call, so the attacker's receive()
    // fails, so the escrow's payment fails, so the whole thing reverts.
    await viem.assertions.revertWithCustomError(
      attacker.write.attack({ account: stranger.account }),
      escrow,
      "TransferFailed",
    );

    // Nothing was stolen: the escrow still holds everyone's money
    assert.equal(await escrowBalance(escrow), parseEther("0.5"));
    assert.equal(await escrow.read.pendingWithdrawals([buyer.account.address]), 0n); // honest buyer's deal still Funded
    assert.equal((await escrow.read.getDeal([0n])).status, DealStatus.Funded);
  });
});
