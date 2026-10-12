// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Escrow} from "../Escrow.sol";

/// @title ReentrancyAttacker: a MALICIOUS contract, used only in tests
/// @notice It tries the classic reentrancy attack on Escrow.withdraw():
///         when the escrow sends it ETH, its `receive()` function runs and
///         immediately calls withdraw() AGAIN, before the first withdraw has
///         finished, hoping to be paid twice (and drain everyone else's money).
///         Our tests prove the attack FAILS. This file is never deployed by
///         the LinXar deployment; it only exists for testing.
contract ReentrancyAttacker {
    Escrow public immutable escrow;

    constructor(Escrow target) {
        escrow = target;
    }

    // Step 1: open a deal (the attacker is the "buyer") and lock some ETH
    function openDeal(uint256 listingId) external payable {
        escrow.openDeal{value: msg.value}(listingId);
    }

    // Step 2: cancel it, so the escrow now owes the attacker a refund
    function cancel(uint256 dealId) external {
        escrow.cancelDeal(dealId);
    }

    // Step 3: withdraw the refund… which triggers receive() below
    function attack() external {
        escrow.withdraw();
    }

    // `receive` runs automatically whenever this contract is SENT ETH.
    // This is where the attack happens: while the escrow is still in the
    // middle of sending us our refund, we call withdraw() again.
    receive() external payable {
        escrow.withdraw();
    }
}
