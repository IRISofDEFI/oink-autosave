// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OinkAutosaveBase} from "./OinkAutosave.Base.t.sol";
import {OinkAutosave} from "../OinkAutosave.sol";

/// @dev Tests: withdraw, withdrawAll, cancelPlan auto-withdraw.
contract OinkAutosaveWithdrawTest is OinkAutosaveBase {

    uint256 internal planId;

    function setUp() public override {
        super.setUp();
        planId = _alicePlan();
        // Execute two saves so alice has SAVE_AMOUNT * 2 in the contract.
        _warpOneCycle();
        saver.executeSave(planId);
        _warpOneCycle();
        saver.executeSave(planId);
        // savedBalance == SAVE_AMOUNT * 2
    }

    // ══════════════════════════════════════════════════════════════════════════
    // withdraw — happy path
    // ══════════════════════════════════════════════════════════════════════════

    function test_Withdraw_Partial_TransfersCorrectAmount() public {
        uint256 before = usdc.balanceOf(alice);

        vm.prank(alice);
        saver.withdraw(planId, SAVE_AMOUNT);

        assertEq(usdc.balanceOf(alice), before + SAVE_AMOUNT);
    }

    function test_Withdraw_Partial_DecreasesSavedBalance() public {
        vm.prank(alice);
        saver.withdraw(planId, SAVE_AMOUNT);

        assertEq(saver.getPlan(planId).savedBalance, SAVE_AMOUNT);
    }

    function test_Withdraw_Full_ZerosSavedBalance() public {
        uint256 total = saver.getPlan(planId).savedBalance;

        vm.prank(alice);
        saver.withdraw(planId, total);

        assertEq(saver.getPlan(planId).savedBalance, 0);
    }

    function test_Withdraw_EmitsWithdrawn() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(saver));
        emit OinkAutosave.Withdrawn(planId, alice, SAVE_AMOUNT);
        saver.withdraw(planId, SAVE_AMOUNT);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // withdraw — revert paths
    // ══════════════════════════════════════════════════════════════════════════

    function test_Withdraw_RevertsIfNotOwner() public {
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.NotPlanOwner.selector, planId, bob, alice)
        );
        saver.withdraw(planId, SAVE_AMOUNT);
    }

    function test_Withdraw_RevertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(OinkAutosave.ZeroAmount.selector);
        saver.withdraw(planId, 0);
    }

    function test_Withdraw_RevertsIfMoreThanBalance() public {
        uint256 bal = saver.getPlan(planId).savedBalance;

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                OinkAutosave.InsufficientSavedBalance.selector,
                planId,
                bal + 1,
                bal
            )
        );
        saver.withdraw(planId, bal + 1);
    }

    function test_Withdraw_RevertsOnNonExistentPlan() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.PlanNotFound.selector, 999)
        );
        saver.withdraw(999, SAVE_AMOUNT);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // withdrawAll — happy path
    // ══════════════════════════════════════════════════════════════════════════

    function test_WithdrawAll_TransfersEntireBalance() public {
        uint256 total  = saver.getPlan(planId).savedBalance;
        uint256 before = usdc.balanceOf(alice);

        vm.prank(alice);
        saver.withdrawAll(planId);

        assertEq(usdc.balanceOf(alice), before + total);
    }

    function test_WithdrawAll_ZerosSavedBalance() public {
        vm.prank(alice);
        saver.withdrawAll(planId);

        assertEq(saver.getPlan(planId).savedBalance, 0);
    }

    function test_WithdrawAll_EmitsWithdrawn() public {
        uint256 total = saver.getPlan(planId).savedBalance;

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(saver));
        emit OinkAutosave.Withdrawn(planId, alice, total);
        saver.withdrawAll(planId);
    }

    function test_WithdrawAll_RevertsIfNotOwner() public {
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.NotPlanOwner.selector, planId, bob, alice)
        );
        saver.withdrawAll(planId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // cancelPlan — auto-withdraw + state
    // ══════════════════════════════════════════════════════════════════════════

    function test_CancelPlan_AutoWithdrawsBalance() public {
        uint256 total  = saver.getPlan(planId).savedBalance;
        uint256 before = usdc.balanceOf(alice);

        vm.prank(alice);
        saver.cancelPlan(planId);

        assertEq(usdc.balanceOf(alice), before + total);
        assertEq(saver.getPlan(planId).savedBalance, 0);
    }

    function test_CancelPlan_SetsCancelled() public {
        vm.prank(alice);
        saver.cancelPlan(planId);

        assertTrue(saver.getPlan(planId).cancelled);
    }

    function test_CancelPlan_EmitsPlanCancelled() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, false, address(saver));
        emit OinkAutosave.PlanCancelled(planId);
        saver.cancelPlan(planId);
    }

    function test_CancelPlan_EmitsWithdrawnWhenBalanceNonZero() public {
        uint256 total = saver.getPlan(planId).savedBalance;

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(saver));
        emit OinkAutosave.Withdrawn(planId, alice, total);
        saver.cancelPlan(planId);
    }

    function test_CancelPlan_RevertsOnSecondCancel() public {
        vm.prank(alice);
        saver.cancelPlan(planId);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.PlanCancelled_.selector, planId)
        );
        saver.cancelPlan(planId);
    }

    function test_CancelPlan_WithZeroBalance_NoPriorWithdrawn() public {
        // Drain manually first, then cancel.
        vm.prank(alice);
        saver.withdrawAll(planId);

        // cancelPlan with zero balance — Withdrawn should NOT be emitted,
        // PlanCancelled should be emitted.
        vm.prank(alice);
        vm.expectEmit(true, false, false, false, address(saver));
        emit OinkAutosave.PlanCancelled(planId);
        saver.cancelPlan(planId);

        assertTrue(saver.getPlan(planId).cancelled);
    }

    function test_CancelPlan_RevertsIfNotOwner() public {
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(OinkAutosave.NotPlanOwner.selector, planId, bob, alice)
        );
        saver.cancelPlan(planId);
    }

    function test_Withdraw_RevertsOnCancelledPlan() public {
        vm.prank(alice);
        saver.cancelPlan(planId);

        // After cancel, savedBalance == 0, so InsufficientSavedBalance fires
        // (not a dedicated "plan is cancelled" check in withdraw, which is fine).
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                OinkAutosave.InsufficientSavedBalance.selector,
                planId,
                SAVE_AMOUNT,
                0
            )
        );
        saver.withdraw(planId, SAVE_AMOUNT);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // totalSaved view
    // ══════════════════════════════════════════════════════════════════════════

    function test_TotalSaved_ReturnsCurrentBalance() public view {
        assertEq(saver.totalSaved(planId), SAVE_AMOUNT * 2);
    }

    function test_TotalSaved_UpdatesAfterWithdraw() public {
        vm.prank(alice);
        saver.withdraw(planId, SAVE_AMOUNT);
        assertEq(saver.totalSaved(planId), SAVE_AMOUNT);
    }
}
