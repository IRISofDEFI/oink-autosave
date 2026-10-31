// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract OinkAutosave is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Plan {
        uint256 amount;
        uint256 cycleLength;
        uint256 goal;
        uint256 savedBalance;
        uint256 lastSaveTimestamp;
        bool paused;
        bool cancelled;
        address owner;
    }

    error PlanNotFound(uint256 planId);
    error PlanCancelled_(uint256 planId);
    error PlanPaused_(uint256 planId);
    error PlanNotDue(uint256 planId, uint256 nextDue, uint256 currentTime);
    error NotPlanOwner(uint256 planId, address caller, address owner);
    error ZeroAmount();
    error InvalidCycleLength();
    error InvalidGoal();
    error InsufficientSavedBalance(uint256 planId, uint256 requested, uint256 available);
    error ZeroAddress();
    error InvalidTokenAddress();

    event PlanCreated(
        uint256 indexed planId,
        address indexed owner,
        uint256 amount,
        uint256 cycleLength,
        uint256 goal
    );
    event SaveExecuted(uint256 indexed planId, address indexed owner, uint256 amount, uint256 newSavedBalance);
    event Withdrawn(uint256 indexed planId, address indexed owner, uint256 amount);
    event PlanPaused(uint256 indexed planId);
    event PlanResumed(uint256 indexed planId);
    event PlanCancelled(uint256 indexed planId);

    mapping(uint256 => Plan) public plans;
    mapping(address => uint256[]) public userPlans;
    uint256 public nextPlanId = 1;

    IERC20 public immutable usdc;

    /// @notice The contract pools all saved USDC at this contract address.
    /// Circle (USDC issuer) retains the ability to freeze any address at the
    /// protocol level. While extremely unlikely for a compliant savings contract,
    /// a freeze would prevent withdrawals. Users should be aware of this
    /// centralized-stablecoin custody risk inherent to any USDC-holding contract.
    constructor(address usdcToken) {
        if (usdcToken == address(0)) revert ZeroAddress();
        // Require the token address to be a deployed contract, not an EOA or
        // incorrect address, to catch misconfigured deployments early.
        if (usdcToken.code.length == 0) revert InvalidTokenAddress();
        usdc = IERC20(usdcToken);
    }

    function createPlan(uint256 amount, uint256 cycleLength, uint256 goal) external returns (uint256 planId) {
        if (amount == 0) revert ZeroAmount();
        if (cycleLength < 60) revert InvalidCycleLength();
        if (goal != 0 && goal < amount) revert InvalidGoal();

        planId = nextPlanId;
        nextPlanId = planId + 1;

        plans[planId] = Plan({
            amount: amount,
            cycleLength: cycleLength,
            goal: goal,
            savedBalance: 0,
            lastSaveTimestamp: block.timestamp,
            paused: false,
            cancelled: false,
            owner: msg.sender
        });

        userPlans[msg.sender].push(planId);

        emit PlanCreated(planId, msg.sender, amount, cycleLength, goal);
    }

    function executeSave(uint256 planId) external nonReentrant {
        Plan storage plan = _getPlanStorage(planId);

        if (plan.cancelled) revert PlanCancelled_(planId);
        if (plan.paused) revert PlanPaused_(planId);
        if (block.timestamp < plan.lastSaveTimestamp + plan.cycleLength) {
            revert PlanNotDue(planId, plan.lastSaveTimestamp + plan.cycleLength, block.timestamp);
        }

        usdc.safeTransferFrom(plan.owner, address(this), plan.amount);

        plan.savedBalance += plan.amount;
        plan.lastSaveTimestamp = block.timestamp;

        emit SaveExecuted(planId, plan.owner, plan.amount, plan.savedBalance);
    }

    function withdraw(uint256 planId, uint256 amount) external nonReentrant {
        Plan storage plan = _getPlanStorage(planId);
        if (msg.sender != plan.owner) revert NotPlanOwner(planId, msg.sender, plan.owner);

        _withdraw(planId, plan, amount);
    }

    function withdrawAll(uint256 planId) external nonReentrant {
        Plan storage plan = _getPlanStorage(planId);
        if (msg.sender != plan.owner) revert NotPlanOwner(planId, msg.sender, plan.owner);

        _withdraw(planId, plan, plan.savedBalance);
    }

    function pausePlan(uint256 planId) external {
        Plan storage plan = _getPlanStorage(planId);
        if (msg.sender != plan.owner) revert NotPlanOwner(planId, msg.sender, plan.owner);
        if (plan.cancelled) revert PlanCancelled_(planId);

        plan.paused = true;

        emit PlanPaused(planId);
    }

    function resumePlan(uint256 planId) external {
        Plan storage plan = _getPlanStorage(planId);
        if (msg.sender != plan.owner) revert NotPlanOwner(planId, msg.sender, plan.owner);
        if (plan.cancelled) revert PlanCancelled_(planId);

        plan.paused = false;

        emit PlanResumed(planId);
    }

    function cancelPlan(uint256 planId) external nonReentrant {
        Plan storage plan = _getPlanStorage(planId);
        if (msg.sender != plan.owner) revert NotPlanOwner(planId, msg.sender, plan.owner);
        if (plan.cancelled) revert PlanCancelled_(planId);

        uint256 amountToWithdraw = plan.savedBalance;
        if (amountToWithdraw > 0) {
            plan.savedBalance = 0;
            usdc.safeTransfer(plan.owner, amountToWithdraw);
            emit Withdrawn(planId, plan.owner, amountToWithdraw);
        }

        plan.cancelled = true;

        emit PlanCancelled(planId);
    }

    function getPlan(uint256 planId) external view returns (Plan memory) {
        _requirePlanExists(planId);
        return plans[planId];
    }

    function getUserPlans(address user) external view returns (uint256[] memory) {
        return userPlans[user];
    }

    function nextSaveTime(uint256 planId) external view returns (uint256) {
        Plan storage plan = _getPlanStorage(planId);
        return plan.lastSaveTimestamp + plan.cycleLength;
    }

    function isDue(uint256 planId) external view returns (bool) {
        Plan storage plan = _getPlanStorage(planId);
        return block.timestamp >= plan.lastSaveTimestamp + plan.cycleLength;
    }

    function totalSaved(uint256 planId) external view returns (uint256) {
        Plan storage plan = _getPlanStorage(planId);
        return plan.savedBalance;
    }

    function _withdraw(uint256 planId, Plan storage plan, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        if (amount > plan.savedBalance) revert InsufficientSavedBalance(planId, amount, plan.savedBalance);

        plan.savedBalance -= amount;
        usdc.safeTransfer(plan.owner, amount);

        emit Withdrawn(planId, plan.owner, amount);
    }

    function _getPlanStorage(uint256 planId) internal view returns (Plan storage plan) {
        _requirePlanExists(planId);
        return plans[planId];
    }

    function _requirePlanExists(uint256 planId) internal view {
        if (planId == 0 || planId >= nextPlanId) revert PlanNotFound(planId);
    }
}
