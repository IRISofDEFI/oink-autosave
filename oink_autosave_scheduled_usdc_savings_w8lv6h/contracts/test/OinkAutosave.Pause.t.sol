// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OinkAutosaveBase} from "./OinkAutosave.Base.t.sol";
import {OinkAutosave} from "../OinkAutosave.sol";

/// @dev Tests: pausePlan, resumePlan — toggle state, events, access-control,
///             interaction with executeSave after resume.
contract OinkAutosavePauseTest is OinkAutosaveBase {

    uint256 internal planId;

    function setUp() public override {
        super.setUp();
        planId = _alicePlan();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // pausePlan — happy path
    // ══════════════════════════════════════════════════════════════════════════

    function test_PausePlan_SetsPausedTrue() public {
        vm.prank(alice);
        saver.pausePlan(planId);
        assertTrue(saver.getPlan(planId).paused);
    }

    function test_PausePlan_EmitsPlanPaused() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, false, address(saver));
        emit OinkAutosave.PlanPaused(planId);
        saver.pausePlan(planId);
    }

    function test_PausePlan_RevertsIfNotOwner() public {
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.NotPlanOwner.selector, planId, bob, alice)
        );
        saver.pausePlan(planId);
    }

    function test_PausePlan_RevertsIfAlreadyCancelled() public {
        vm.prank(alice);
        saver.cancelPlan(planId);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.PlanCancelled_.selector, planId)
        );
        saver.pausePlan(planId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // resumePlan — happy path
    // ══════════════════════════════════════════════════════════════════════════

    function test_ResumePlan_SetsPausedFalse() public {
        vm.prank(alice);
        saver.pausePlan(planId);

        vm.prank(alice);
        saver.resumePlan(planId);

        assertFalse(saver.getPlan(planId).paused);
    }

    function test_ResumePlan_EmitsPlanResumed() public {
        vm.prank(alice);
        saver.pausePlan(planId);

        vm.prank(alice);
        vm.expectEmit(true, false, false, false, address(saver));
        emit OinkAutosave.PlanResumed(planId);
        saver.resumePlan(planId);
    }

    function test_ResumePlan_RevertsIfNotOwner() public {
        vm.prank(alice);
        saver.pausePlan(planId);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.NotPlanOwner.selector, planId, bob, alice)
        );
        saver.resumePlan(planId);
    }

    function test_ResumePlan_RevertsIfAlreadyCancelled() public {
        vm.prank(alice);
        saver.cancelPlan(planId);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.PlanCancelled_.selector, planId)
        );
        saver.resumePlan(planId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Pause → Resume → executeSave flow
    // ══════════════════════════════════════════════════════════════════════════

    function test_PauseResume_ExecuteSaveSucceedsAfterResume() public {
        vm.prank(alice);
        saver.pausePlan(planId);

        vm.prank(alice);
        saver.resumePlan(planId);

        _warpOneCycle();
        saver.executeSave(planId);

        assertEq(saver.getPlan(planId).savedBalance, SAVE_AMOUNT);
    }

    function test_PauseDuringCycle_ResumeDoesNotResetTimer() public {
        // Warp half a cycle, pause, warp the other half, resume, should be due.
        skip(CYCLE / 2);

        vm.prank(alice);
        saver.pausePlan(planId);

        skip(CYCLE / 2);

        vm.prank(alice);
        saver.resumePlan(planId);

        // Full cycle has elapsed since creation — executeSave should succeed.
        saver.executeSave(planId);
        assertEq(saver.getPlan(planId).savedBalance, SAVE_AMOUNT);
    }
}
