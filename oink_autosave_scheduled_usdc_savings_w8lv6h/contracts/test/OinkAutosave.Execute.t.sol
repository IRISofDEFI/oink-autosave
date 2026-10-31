// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OinkAutosaveBase} from "./OinkAutosave.Base.t.sol";
import {OinkAutosave} from "../OinkAutosave.sol";

/// @dev Tests: executeSave happy-path, reverts, permissionless caller,
///             multiple cycles.
contract OinkAutosaveExecuteTest is OinkAutosaveBase {

    uint256 internal planId;

    function setUp() public override {
        super.setUp();
        planId = _alicePlan();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // executeSave — happy path
    // ══════════════════════════════════════════════════════════════════════════

    function test_ExecuteSave_TransfersUsdcToContract() public {
        uint256 aliceBefore    = usdc.balanceOf(alice);
        uint256 contractBefore = usdc.balanceOf(address(saver));

        _warpOneCycle();
        saver.executeSave(planId);

        assertEq(usdc.balanceOf(alice),          aliceBefore    - SAVE_AMOUNT);
        assertEq(usdc.balanceOf(address(saver)), contractBefore + SAVE_AMOUNT);
    }

    function test_ExecuteSave_UpdatesSavedBalance() public {
        _warpOneCycle();
        saver.executeSave(planId);
        assertEq(saver.getPlan(planId).savedBalance, SAVE_AMOUNT);
    }

    function test_ExecuteSave_UpdatesLastSaveTimestamp() public {
        _warpOneCycle();
        uint256 ts = block.timestamp;
        saver.executeSave(planId);
        assertEq(saver.getPlan(planId).lastSaveTimestamp, ts);
    }

    function test_ExecuteSave_EmitsSaveExecuted() public {
        _warpOneCycle();
        vm.expectEmit(true, true, false, true, address(saver));
        emit OinkAutosave.SaveExecuted(planId, alice, SAVE_AMOUNT, SAVE_AMOUNT);
        saver.executeSave(planId);
    }

    function test_ExecuteSave_ByNonOwnerSucceeds() public {
        // executeSave is permissionless — charlie (not alice) can trigger it.
        _warpOneCycle();
        vm.prank(charlie);
        saver.executeSave(planId);
        assertEq(saver.getPlan(planId).savedBalance, SAVE_AMOUNT);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // executeSave — multiple consecutive cycles
    // ══════════════════════════════════════════════════════════════════════════

    function test_ExecuteSave_MultipleCycles_AccumulatesBalance() public {
        uint256 cycles = 5;
        for (uint256 i = 0; i < cycles; i++) {
            _warpOneCycle();
            saver.executeSave(planId);
        }
        assertEq(saver.getPlan(planId).savedBalance, SAVE_AMOUNT * cycles);
    }

    function test_ExecuteSave_MultipleCycles_TransfersTotalUsdc() public {
        uint256 cycles = 3;
        uint256 aliceBefore = usdc.balanceOf(alice);

        for (uint256 i = 0; i < cycles; i++) {
            _warpOneCycle();
            saver.executeSave(planId);
        }

        assertEq(usdc.balanceOf(alice), aliceBefore - SAVE_AMOUNT * cycles);
        assertEq(usdc.balanceOf(address(saver)), SAVE_AMOUNT * cycles);
    }

    function test_ExecuteSave_SecondCallRightAfterFirstReverts() public {
        _warpOneCycle();
        saver.executeSave(planId);

        // Warp only half a cycle — not due yet.
        skip(CYCLE / 2);

        uint256 nextDue = saver.getPlan(planId).lastSaveTimestamp + CYCLE;
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

    // ══════════════════════════════════════════════════════════════════════════
    // executeSave — revert paths
    // ══════════════════════════════════════════════════════════════════════════

    function test_ExecuteSave_RevertsWhenNotDue() public {
        // No warp — plan just created, lastSaveTimestamp == block.timestamp.
        uint256 nextDue = saver.getPlan(planId).lastSaveTimestamp + CYCLE;
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

    function test_ExecuteSave_RevertsOneDayBeforeDue() public {
        skip(CYCLE - 1 days);
        uint256 nextDue = saver.getPlan(planId).lastSaveTimestamp + CYCLE;
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

    function test_ExecuteSave_RevertsWhenPaused() public {
        vm.prank(alice);
        saver.pausePlan(planId);

        _warpOneCycle();
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.PlanPaused_.selector, planId)
        );
        saver.executeSave(planId);
    }

    function test_ExecuteSave_RevertsWhenCancelled() public {
        vm.prank(alice);
        saver.cancelPlan(planId);

        _warpOneCycle();
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.PlanCancelled_.selector, planId)
        );
        saver.executeSave(planId);
    }

    function test_ExecuteSave_RevertsOnNonExistentPlan() public {
        _warpOneCycle();
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.PlanNotFound.selector, 999)
        );
        saver.executeSave(999);
    }

    function test_ExecuteSave_RevertsOnPlanId0() public {
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.PlanNotFound.selector, 0)
        );
        saver.executeSave(0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // isDue / nextSaveTime helpers
    // ══════════════════════════════════════════════════════════════════════════

    function test_IsDue_FalseBeforeCycle() public view {
        assertFalse(saver.isDue(planId));
    }

    function test_IsDue_TrueAfterCycle() public {
        _warpOneCycle();
        assertTrue(saver.isDue(planId));
    }

    function test_NextSaveTime_EqualsCreationPlusCycle() public view {
        OinkAutosave.Plan memory p = saver.getPlan(planId);
        assertEq(saver.nextSaveTime(planId), p.lastSaveTimestamp + CYCLE);
    }
}
