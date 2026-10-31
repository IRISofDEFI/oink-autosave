// SPDX-License-Identifier: MIT
// Flattened by forge flatten — all OpenZeppelin v5 imports inlined.
// Compiler: solc 0.8.28 | EVM: cancun | Optimizer: enabled, 200 runs
pragma solidity 0.8.28;

// ============================================================
// @openzeppelin/contracts/utils/introspection/IERC165.sol
// ============================================================

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

// ============================================================
// @openzeppelin/contracts/token/ERC20/IERC20.sol
// ============================================================

interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// ============================================================
// @openzeppelin/contracts/utils/StorageSlot.sol
// ============================================================

library StorageSlot {
    struct AddressSlot { address value; }
    struct BooleanSlot { bool value; }
    struct Bytes32Slot { bytes32 value; }
    struct Uint256Slot { uint256 value; }
    struct Int256Slot { int256 value; }
    struct StringSlot { string value; }
    struct BytesSlot { bytes value; }

    function getAddressSlot(bytes32 slot) internal pure returns (AddressSlot storage r) {
        assembly ("memory-safe") { r.slot := slot }
    }
    function getBooleanSlot(bytes32 slot) internal pure returns (BooleanSlot storage r) {
        assembly ("memory-safe") { r.slot := slot }
    }
    function getBytes32Slot(bytes32 slot) internal pure returns (Bytes32Slot storage r) {
        assembly ("memory-safe") { r.slot := slot }
    }
    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
        assembly ("memory-safe") { r.slot := slot }
    }
    function getInt256Slot(bytes32 slot) internal pure returns (Int256Slot storage r) {
        assembly ("memory-safe") { r.slot := slot }
    }
    function getStringSlot(bytes32 slot) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") { r.slot := slot }
    }
    function getStringSlot(string storage store) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") { r.slot := store.slot }
    }
    function getBytesSlot(bytes32 slot) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") { r.slot := slot }
    }
    function getBytesSlot(bytes storage store) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") { r.slot := store.slot }
    }
}

// ============================================================
// @openzeppelin/contracts/utils/ReentrancyGuard.sol
// ============================================================

abstract contract ReentrancyGuard {
    using StorageSlot for bytes32;

    bytes32 private constant REENTRANCY_GUARD_STORAGE =
        0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    error ReentrancyGuardReentrantCall();

    constructor() {
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    modifier nonReentrantView() {
        _nonReentrantBeforeView();
        _;
    }

    function _nonReentrantBeforeView() private view {
        if (_reentrancyGuardEntered()) revert ReentrancyGuardReentrantCall();
    }

    function _nonReentrantBefore() private {
        _nonReentrantBeforeView();
        _reentrancyGuardStorageSlot().getUint256Slot().value = ENTERED;
    }

    function _nonReentrantAfter() private {
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    function _reentrancyGuardEntered() internal view returns (bool) {
        return _reentrancyGuardStorageSlot().getUint256Slot().value == ENTERED;
    }

    function _reentrancyGuardStorageSlot() internal pure virtual returns (bytes32) {
        return REENTRANCY_GUARD_STORAGE;
    }
}

// ============================================================
// @openzeppelin/contracts/interfaces/IERC1363.sol
// ============================================================

interface IERC1363 is IERC20, IERC165 {
    function transferAndCall(address to, uint256 value) external returns (bool);
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);
    function transferFromAndCall(address from, address to, uint256 value) external returns (bool);
    function transferFromAndCall(address from, address to, uint256 value, bytes calldata data) external returns (bool);
    function approveAndCall(address spender, uint256 value) external returns (bool);
    function approveAndCall(address spender, uint256 value, bytes calldata data) external returns (bool);
}

// ============================================================
// @openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol
// ============================================================

library SafeERC20 {
    error SafeERC20FailedOperation(address token);
    error SafeERC20FailedDecreaseAllowance(address spender, uint256 currentAllowance, uint256 requestedDecrease);

    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        if (!_safeTransfer(token, to, value, true)) revert SafeERC20FailedOperation(address(token));
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        if (!_safeTransferFrom(token, from, to, value, true)) revert SafeERC20FailedOperation(address(token));
    }

    function trySafeTransfer(IERC20 token, address to, uint256 value) internal returns (bool) {
        return _safeTransfer(token, to, value, false);
    }

    function trySafeTransferFrom(IERC20 token, address from, address to, uint256 value) internal returns (bool) {
        return _safeTransferFrom(token, from, to, value, false);
    }

    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        forceApprove(token, spender, oldAllowance + value);
    }

    function safeDecreaseAllowance(IERC20 token, address spender, uint256 requestedDecrease) internal {
        unchecked {
            uint256 currentAllowance = token.allowance(address(this), spender);
            if (currentAllowance < requestedDecrease)
                revert SafeERC20FailedDecreaseAllowance(spender, currentAllowance, requestedDecrease);
            forceApprove(token, spender, currentAllowance - requestedDecrease);
        }
    }

    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        if (!_safeApprove(token, spender, value, false)) {
            if (!_safeApprove(token, spender, 0, true)) revert SafeERC20FailedOperation(address(token));
            if (!_safeApprove(token, spender, value, true)) revert SafeERC20FailedOperation(address(token));
        }
    }

    function transferAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            safeTransfer(token, to, value);
        } else if (!token.transferAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    function transferFromAndCallRelaxed(IERC1363 token, address from, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            safeTransferFrom(token, from, to, value);
        } else if (!token.transferFromAndCall(from, to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    function approveAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            forceApprove(token, to, value);
        } else if (!token.approveAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    function _safeTransfer(IERC20 token, address to, uint256 value, bool bubble) private returns (bool success) {
        bytes4 selector = IERC20.transfer.selector;
        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(to, shr(96, not(0))))
            mstore(0x24, value)
            success := call(gas(), token, 0, 0x00, 0x44, 0x00, 0x20)
            if iszero(and(success, eq(mload(0x00), 1))) {
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
        }
    }

    function _safeTransferFrom(IERC20 token, address from, address to, uint256 value, bool bubble) private returns (bool success) {
        bytes4 selector = IERC20.transferFrom.selector;
        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(from, shr(96, not(0))))
            mstore(0x24, and(to, shr(96, not(0))))
            mstore(0x44, value)
            success := call(gas(), token, 0, 0x00, 0x64, 0x00, 0x20)
            if iszero(and(success, eq(mload(0x00), 1))) {
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
            mstore(0x60, 0)
        }
    }

    function _safeApprove(IERC20 token, address spender, uint256 value, bool bubble) private returns (bool success) {
        bytes4 selector = IERC20.approve.selector;
        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(spender, shr(96, not(0))))
            mstore(0x24, value)
            success := call(gas(), token, 0, 0x00, 0x44, 0x00, 0x20)
            if iszero(and(success, eq(mload(0x00), 1))) {
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
        }
    }
}

// ============================================================
// contracts/OinkAutosave.sol
// ============================================================

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
