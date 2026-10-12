// =============================================================================
// Tests for AgentBadge.sol: soulbound "Verified Agent" badges
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress } from "viem";

const PROFILE_CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

describe("AgentBadge", async function () {
  const { viem, networkHelpers } = await network.create();
  const [admin, verifier, agent, stranger] = await viem.getWalletClients();

  async function deployBadges() {
    const badges = await viem.deployContract("AgentBadge", [], { client: { wallet: admin } });
    const VERIFIER_ROLE = await badges.read.VERIFIER_ROLE();
    await badges.write.grantRole([VERIFIER_ROLE, verifier.account.address], { account: admin.account });
    return { badges, VERIFIER_ROLE };
  }

  async function deployWithVerifiedAgent() {
    const { badges, VERIFIER_ROLE } = await deployBadges();
    await badges.write.issueBadge([agent.account.address, PROFILE_CID], { account: verifier.account });
    return { badges, VERIFIER_ROLE };
  }

  it("lets a verifier issue a badge, which anyone can check for free", async function () {
    const { badges } = await networkHelpers.loadFixture(deployBadges);
    assert.equal(await badges.read.isVerified([agent.account.address]), false);

    await viem.assertions.emitWithArgs(
      badges.write.issueBadge([agent.account.address, PROFILE_CID], { account: verifier.account }),
      badges,
      "AgentVerified",
      [getAddress(agent.account.address), getAddress(verifier.account.address), PROFILE_CID],
    );

    assert.equal(await badges.read.isVerified([agent.account.address]), true);
    // It's a real NFT in the agent's wallet
    assert.equal(await badges.read.balanceOf([agent.account.address]), 1n);
    const badge = await badges.read.getBadge([agent.account.address]);
    assert.equal(getAddress(badge.issuedBy), getAddress(verifier.account.address));
    assert.equal(badge.profileCID, PROFILE_CID);
  });

  // SECURITY: you can't make yourself verified
  it("does not let a non-verifier issue badges, not even to themselves", async function () {
    const { badges, VERIFIER_ROLE } = await networkHelpers.loadFixture(deployBadges);
    await viem.assertions.revertWithCustomErrorWithArgs(
      badges.write.issueBadge([stranger.account.address, PROFILE_CID], { account: stranger.account }),
      badges,
      "AccessControlUnauthorizedAccount",
      [getAddress(stranger.account.address), VERIFIER_ROLE],
    );
  });

  it("refuses a second badge for the same agent", async function () {
    const { badges } = await networkHelpers.loadFixture(deployWithVerifiedAgent);
    await viem.assertions.revertWithCustomErrorWithArgs(
      badges.write.issueBadge([agent.account.address, PROFILE_CID], { account: verifier.account }),
      badges,
      "AlreadyVerified",
      [getAddress(agent.account.address)],
    );
  });

  // SOULBOUND: the badge can't be sold, given away or moved
  it("is soulbound: the agent can't transfer their badge to anyone", async function () {
    const { badges } = await networkHelpers.loadFixture(deployWithVerifiedAgent);
    const id = await badges.read.badgeId([agent.account.address]);

    await viem.assertions.revertWithCustomError(
      badges.write.transferFrom([agent.account.address, stranger.account.address, id], { account: agent.account }),
      badges,
      "Soulbound",
    );
    // Still the agent's, and the stranger is still unverified
    assert.equal(await badges.read.isVerified([agent.account.address]), true);
    assert.equal(await badges.read.isVerified([stranger.account.address]), false);
  });

  it("lets a verifier revoke a badge (burning the NFT)", async function () {
    const { badges } = await networkHelpers.loadFixture(deployWithVerifiedAgent);

    await viem.assertions.emitWithArgs(
      badges.write.revokeBadge([agent.account.address], { account: verifier.account }),
      badges,
      "AgentRevoked",
      [getAddress(agent.account.address), getAddress(verifier.account.address)],
    );
    assert.equal(await badges.read.isVerified([agent.account.address]), false);
    assert.equal(await badges.read.balanceOf([agent.account.address]), 0n);
  });

  it("does not let the agent (or anyone else) revoke badges", async function () {
    const { badges, VERIFIER_ROLE } = await networkHelpers.loadFixture(deployWithVerifiedAgent);
    await viem.assertions.revertWithCustomErrorWithArgs(
      badges.write.revokeBadge([agent.account.address], { account: stranger.account }),
      badges,
      "AccessControlUnauthorizedAccount",
      [getAddress(stranger.account.address), VERIFIER_ROLE],
    );
  });
});
