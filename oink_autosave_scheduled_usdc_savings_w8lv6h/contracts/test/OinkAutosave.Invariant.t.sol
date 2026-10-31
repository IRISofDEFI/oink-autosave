// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OinkAutosave} from "../OinkAutosave.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Handler: exposes bounded actions the fuzzer drives. Tracks a ghost sum
///      of all unwithdrawable plan savedBalances across arbitrary actors.
contract AutosaveHandler is Test {
    // ── immutables ────────────────────────────────────────────────────────────
    OinkAutosave public saver;
    MockERC20    public usdc;

    // ── state ─────────────────────────────────────────────────────────────────
    address[] public actors;
    uint256[] public planIds;

    /// Ghost: running total of all plan.savedBalance values (sum the handler
    /// knows about).  The invariant checks contractBalance >= ghostSum.
    uint256 public ghostSavedSum;

    uint256 internal constant SAVE_AMT  = 50e6;
    uint256 internal constant CYCLE_LEN = 7 days;
    uint256 internal constant MINT_AMT  = 1_000_000e6;

    constructor(OinkAutosave _saver, MockERC20 _usdc) {
        saver = _saver;
        usdc  = _usdc;

        // Pre-create three actors, fund them, and give them a plan each.
        for (uint256 i = 0; i < 3; i++) {
            address actor = makeAddr(string(abi.encodePacked("actor", i)));
            actors.push(actor);
            usdc.mint(actor, MINT_AMT);
            vm.prank(actor);
            usdc.approve(address(saver), type(uint256).max);
            vm.prank(actor);
            uint256 id = saver.createPlan(SAVE_AMT, CYCLE_LEN, 0);
            planIds.push(id);
        }
    }

    // ── handler actions ───────────────────────────────────────────────────────

    /// Advance time and execute a save on a randomly chosen plan.
    function executeSave(uint256 actorSeed, uint256 extraTime) external {
        uint256 idx    = bound(actorSeed, 0, planIds.length - 1);
        uint256 planId = planIds[idx];

        OinkAutosave.Plan memory p = saver.getPlan(planId);
        if (p.cancelled || p.paused) return;

        // Make the plan due: warp at least one full cycle beyond last save.
        uint256 nextDue = p.lastSaveTimestamp + p.cycleLength;
        if (block.timestamp < nextDue) {
            vm.warp(nextDue + bound(extraTime, 0, 1 days));
        }

        saver.executeSave(planId);
        ghostSavedSum += SAVE_AMT;
    }

    /// Withdraw a bounded amount from a randomly chosen plan (by owner).
    function withdraw(uint256 actorSeed, uint256 amountSeed) external {
        uint256 idx    = bound(actorSeed, 0, planIds.length - 1);
        uint256 planId = planIds[idx];
        address actor  = actors[idx];

        OinkAutosave.Plan memory p = saver.getPlan(planId);
        if (p.savedBalance == 0) return;

        uint256 amount = bound(amountSeed, 1, p.savedBalance);
        vm.prank(actor);
        saver.withdraw(planId, amount);
        ghostSavedSum -= amount;
    }

    /// Pause a randomly chosen plan.
    function pause(uint256 actorSeed) external {
        uint256 idx    = bound(actorSeed, 0, planIds.length - 1);
        uint256 planId = planIds[idx];
        address actor  = actors[idx];

        OinkAutosave.Plan memory p = saver.getPlan(planId);
        if (p.paused || p.cancelled) return;

        vm.prank(actor);
        saver.pausePlan(planId);
    }

    /// Resume a randomly chosen plan.
    function resume(uint256 actorSeed) external {
        uint256 idx    = bound(actorSeed, 0, planIds.length - 1);
        uint256 planId = planIds[idx];
        address actor  = actors[idx];

        OinkAutosave.Plan memory p = saver.getPlan(planId);
        if (!p.paused || p.cancelled) return;

        vm.prank(actor);
        saver.resumePlan(planId);
    }
}

/// @dev Invariant test contract.
contract OinkAutosaveInvariantTest is Test {
    OinkAutosave    internal saver;
    MockERC20       internal usdc;
    AutosaveHandler internal handler;

    function setUp() public {
        usdc    = new MockERC20("Mock USDC", "mUSDC", 6);
        saver   = new OinkAutosave(address(usdc));
        handler = new AutosaveHandler(saver, usdc);

        targetContract(address(handler));
    }

    /// INVARIANT: the contract's USDC balance is always >= sum of all
    /// plan savedBalances tracked by the handler.
    function invariant_ContractBalanceGeSavedSum() public view {
        assertGe(
            usdc.balanceOf(address(saver)),
            handler.ghostSavedSum(),
            "contract USDC balance < ghost saved sum"
        );
    }

    /// INVARIANT: nextPlanId only increases — never decreases or resets.
    function invariant_NextPlanIdOnlyIncreases() public view {
        // At least 4 (3 from handler constructor + initial 1).
        assertGe(saver.nextPlanId(), 4);
    }
}
