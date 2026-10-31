// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OinkAutosaveBase} from "./OinkAutosave.Base.t.sol";
import {OinkAutosave} from "../OinkAutosave.sol";

/// @dev Fuzz tests for createPlan and executeSave arithmetic.
contract OinkAutosaveFuzzTest is OinkAutosaveBase {

    // ══════════════════════════════════════════════════════════════════════════
    // createPlan — fuzz amount, cycleLength, goal
    // ══════════════════════════════════════════════════════════════════════════

    /// PROPERTY: any valid (amount, cycleLength, goal) triple stores exactly
    /// what was passed.
    function testFuzz_CreatePlan_StoresFields(
        uint256 amount,
        uint256 cycleLength,
        uint256 goal
    ) public {
        // Constrain to valid domain.
        amount      = bound(amount,      1,    type(uint128).max);
        cycleLength = bound(cycleLength, 60,   365 days);
        // goal must be 0 OR >= amount; pick 0 or bound >= amount.
        // Use the lower half of fuzzed goal space for zero, upper for >= amount.
        if (goal % 2 == 0) {
            goal = 0;
        } else {
            goal = bound(goal, amount, type(uint128).max);
        }

        vm.prank(alice);
        uint256 id = saver.createPlan(amount, cycleLength, goal);

        OinkAutosave.Plan memory p = saver.getPlan(id);
        assertEq(p.amount,      amount,      "amount mismatch");
        assertEq(p.cycleLength, cycleLength, "cycleLength mismatch");
        assertEq(p.goal,        goal,        "goal mismatch");
        assertEq(p.owner,       alice,       "owner mismatch");
        assertEq(p.savedBalance, 0,          "savedBalance should start at 0");
        assertFalse(p.paused,                "should not be paused");
        assertFalse(p.cancelled,             "should not be cancelled");
    }

    /// PROPERTY: nextPlanId increments by 1 for every successful createPlan.
    function testFuzz_CreatePlan_IncrementsNextPlanId(uint8 n) public {
        n = uint8(bound(n, 1, 20)); // cap to 20 plans
        uint256 before = saver.nextPlanId();

        vm.startPrank(alice);
        for (uint256 i = 0; i < n; i++) {
            saver.createPlan(SAVE_AMOUNT, CYCLE, 0);
        }
        vm.stopPrank();

        assertEq(saver.nextPlanId(), before + n);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // createPlan — fuzz boundary violations
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_CreatePlan_InvalidCycle_Reverts(uint256 badCycle) public {
        // Any cycle < 60 must revert.
        badCycle = bound(badCycle, 0, 59);
        vm.prank(alice);
        vm.expectRevert(OinkAutosave.InvalidCycleLength.selector);
        saver.createPlan(SAVE_AMOUNT, badCycle, GOAL);
    }

    function testFuzz_CreatePlan_InvalidGoal_Reverts(
        uint256 amount,
        uint256 goal
    ) public {
        amount = bound(amount, 2, type(uint128).max); // at least 2 so goal = amount-1 >= 1
        goal   = bound(goal,   1, amount - 1);        // non-zero but less than amount

        vm.prank(alice);
        vm.expectRevert(OinkAutosave.InvalidGoal.selector);
        saver.createPlan(amount, CYCLE, goal);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // executeSave — fuzz cycle count
    // ══════════════════════════════════════════════════════════════════════════

    /// PROPERTY: after N cycles, savedBalance == amount * N.
    function testFuzz_ExecuteSave_BalanceAccumulates(uint8 cycles) public {
        cycles = uint8(bound(cycles, 1, 20));

        // Give alice enough to cover all saves.
        uint256 needed = SAVE_AMOUNT * cycles;
        usdc.mint(alice, needed); // extra on top of base MINT_AMOUNT

        uint256 planId = _alicePlan();

        for (uint256 i = 0; i < cycles; i++) {
            _warpOneCycle();
            saver.executeSave(planId);
        }

        assertEq(saver.getPlan(planId).savedBalance, SAVE_AMOUNT * uint256(cycles));
    }

    /// PROPERTY: withdraw after N saves gives back exactly N * amount.
    function testFuzz_Withdraw_AfterNSaves_CorrectAmount(uint8 cycles) public {
        cycles = uint8(bound(cycles, 1, 10));
        usdc.mint(alice, SAVE_AMOUNT * cycles);

        uint256 planId = _alicePlan();

        for (uint256 i = 0; i < cycles; i++) {
            _warpOneCycle();
            saver.executeSave(planId);
        }

        uint256 total  = saver.getPlan(planId).savedBalance;
        uint256 before = usdc.balanceOf(alice);

        vm.prank(alice);
        saver.withdrawAll(planId);

        assertEq(usdc.balanceOf(alice), before + total);
        assertEq(saver.getPlan(planId).savedBalance, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // executeSave — fuzz time: must fail before due, succeed at/after due
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_ExecuteSave_OnlySucceedsWhenDue(uint256 warpSeconds) public {
        uint256 planId = _alicePlan();
        uint256 cycleLen = saver.getPlan(planId).cycleLength;
        uint256 nextDue  = saver.getPlan(planId).lastSaveTimestamp + cycleLen;

        // Warp to some time within [0, cycleLen - 1] — NOT due.
        warpSeconds = bound(warpSeconds, 0, cycleLen - 1);
        vm.warp(block.timestamp + warpSeconds);

        vm.expectRevert(
            abi.encodeWithSelector(
                OinkAutosave.PlanNotDue.selector,
                planId,
                nextDue,
                block.timestamp
            )
        );
        saver.executeSave(planId);
    }
}
