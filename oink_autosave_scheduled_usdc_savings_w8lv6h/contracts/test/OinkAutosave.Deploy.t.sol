// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OinkAutosaveBase} from "./OinkAutosave.Base.t.sol";
import {OinkAutosave} from "../OinkAutosave.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Tests: constructor, createPlan happy-path, createPlan revert-paths.
contract OinkAutosaveDeployTest is OinkAutosaveBase {

    // ══════════════════════════════════════════════════════════════════════════
    // Constructor
    // ══════════════════════════════════════════════════════════════════════════

    function test_Constructor_SetsUsdcAndNextPlanId() public view {
        assertEq(address(saver.usdc()), address(usdc));
        assertEq(saver.nextPlanId(), 1);
    }

    function test_Constructor_RevertsOnZeroAddress() public {
        vm.expectRevert(OinkAutosave.ZeroAddress.selector);
        new OinkAutosave(address(0));
    }

    function test_Constructor_RevertsOnNonContract() public {
        address eoa = makeAddr("eoa");
        vm.expectRevert(OinkAutosave.InvalidTokenAddress.selector);
        new OinkAutosave(eoa);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // createPlan — happy path
    // ══════════════════════════════════════════════════════════════════════════

    function test_CreatePlan_ReturnsPlanId1() public {
        vm.prank(alice);
        uint256 id = saver.createPlan(SAVE_AMOUNT, CYCLE, GOAL);
        assertEq(id, 1);
    }

    function test_CreatePlan_IncrementsNextPlanId() public {
        _alicePlan();
        assertEq(saver.nextPlanId(), 2);
    }

    function test_CreatePlan_StoresAllFields() public {
        uint256 ts = block.timestamp;
        vm.prank(alice);
        uint256 id = saver.createPlan(SAVE_AMOUNT, CYCLE, GOAL);

        OinkAutosave.Plan memory p = saver.getPlan(id);
        assertEq(p.amount,            SAVE_AMOUNT);
        assertEq(p.cycleLength,       CYCLE);
        assertEq(p.goal,              GOAL);
        assertEq(p.savedBalance,      0);
        assertEq(p.lastSaveTimestamp, ts);
        assertFalse(p.paused);
        assertFalse(p.cancelled);
        assertEq(p.owner,             alice);
    }

    function test_CreatePlan_ZeroGoalAllowed() public {
        vm.prank(alice);
        uint256 id = saver.createPlan(SAVE_AMOUNT, CYCLE, 0);
        assertEq(saver.getPlan(id).goal, 0);
    }

    function test_CreatePlan_GoalEqualToAmountAllowed() public {
        vm.prank(alice);
        // goal == amount is the minimum non-zero valid goal
        uint256 id = saver.createPlan(SAVE_AMOUNT, CYCLE, SAVE_AMOUNT);
        assertEq(saver.getPlan(id).goal, SAVE_AMOUNT);
    }

    function test_CreatePlan_AddsToUserPlans() public {
        uint256 id = _alicePlan();
        uint256[] memory ids = saver.getUserPlans(alice);
        assertEq(ids.length, 1);
        assertEq(ids[0], id);
    }

    function test_CreatePlan_MultiplePlans_UserPlansGrows() public {
        vm.startPrank(alice);
        saver.createPlan(SAVE_AMOUNT,      CYCLE,     GOAL);
        saver.createPlan(SAVE_AMOUNT * 2,  CYCLE * 2, 0);
        vm.stopPrank();

        uint256[] memory ids = saver.getUserPlans(alice);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function test_CreatePlan_EmitsPlanCreated() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(saver));
        emit OinkAutosave.PlanCreated(1, alice, SAVE_AMOUNT, CYCLE, GOAL);
        saver.createPlan(SAVE_AMOUNT, CYCLE, GOAL);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // createPlan — revert paths
    // ══════════════════════════════════════════════════════════════════════════

    function test_CreatePlan_RevertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(OinkAutosave.ZeroAmount.selector);
        saver.createPlan(0, CYCLE, GOAL);
    }

    function test_CreatePlan_RevertsWhenCycleLessThan60() public {
        vm.prank(alice);
        vm.expectRevert(OinkAutosave.InvalidCycleLength.selector);
        saver.createPlan(SAVE_AMOUNT, 59, GOAL);
    }

    function test_CreatePlan_AllowsCycleExactly60() public {
        vm.prank(alice);
        uint256 id = saver.createPlan(SAVE_AMOUNT, 60, GOAL);
        assertEq(saver.getPlan(id).cycleLength, 60);
    }

    function test_CreatePlan_RevertsWhenGoalLessThanAmount() public {
        vm.prank(alice);
        // goal = amount - 1  →  non-zero but < amount
        vm.expectRevert(OinkAutosave.InvalidGoal.selector);
        saver.createPlan(SAVE_AMOUNT, CYCLE, SAVE_AMOUNT - 1);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // getPlan / getUserPlans — revert on non-existent plan
    // ══════════════════════════════════════════════════════════════════════════

    function test_GetPlan_RevertsOnPlanId0() public {
        vm.expectRevert(abi.encodeWithSelector(OinkAutosave.PlanNotFound.selector, 0));
        saver.getPlan(0);
    }

    function test_GetPlan_RevertsOnNonExistentPlanId() public {
        vm.expectRevert(abi.encodeWithSelector(OinkAutosave.PlanNotFound.selector, 99));
        saver.getPlan(99);
    }
}
