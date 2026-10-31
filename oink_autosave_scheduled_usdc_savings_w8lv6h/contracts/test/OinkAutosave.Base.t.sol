// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OinkAutosave} from "../OinkAutosave.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Shared base: deploys MockERC20 + OinkAutosave, seeds actor balances
///      and approvals.  Every category file inherits this.
abstract contract OinkAutosaveBase is Test {
    // ── constants ────────────────────────────────────────────────────────────
    uint256 internal constant SAVE_AMOUNT  = 100e6;   // 100 USDC (6 dp)
    uint256 internal constant CYCLE        = 7 days;
    uint256 internal constant GOAL         = 1_000e6; // 10 saves to reach goal
    uint256 internal constant MINT_AMOUNT  = 10_000e6;

    // ── actors ───────────────────────────────────────────────────────────────
    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal charlie = makeAddr("charlie"); // permissionless executor

    // ── contracts ────────────────────────────────────────────────────────────
    MockERC20    internal usdc;
    OinkAutosave internal saver;

    // ── setUp ────────────────────────────────────────────────────────────────
    function setUp() public virtual {
        // 1. Deploy mock token — must have code.length > 0 before OinkAutosave ctor.
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        // 2. Deploy contract under test, pointing at the mock.
        saver = new OinkAutosave(address(usdc));

        // 3. Seed actors with tokens and max-approve the saver.
        _fund(alice);
        _fund(bob);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// Mint MINT_AMOUNT to `who` and approve OinkAutosave to pull it all.
    function _fund(address who) internal {
        usdc.mint(who, MINT_AMOUNT);
        vm.prank(who);
        usdc.approve(address(saver), type(uint256).max);
    }

    /// Create a default plan as alice and return planId.
    function _alicePlan() internal returns (uint256 planId) {
        vm.prank(alice);
        planId = saver.createPlan(SAVE_AMOUNT, CYCLE, GOAL);
    }

    /// Warp forward by exactly one full cycle so executeSave is due.
    function _warpOneCycle() internal {
        skip(CYCLE);
    }
}
