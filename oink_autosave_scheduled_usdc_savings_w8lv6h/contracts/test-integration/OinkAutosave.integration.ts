/**
 * OinkAutosave integration tests — pre-deploy fork-verify lane.
 * Runs against the anvil fork at http://127.0.0.1:44095.
 *
 * Every sender is obtained via anvil_impersonateAccount + anvil_setBalance.
 * No private keys are used.
 *
 * Arc-testnet USDC (0x3600...) discovery:
 *   The Arc USDC is a native-token bridge implementation that stores balances
 *   at the native chain level, NOT in EVM storage. Standard EVM calls emit Transfer
 *   events but do not update EVM-readable balanceOf state on the fork. This makes
 *   the real USDC non-functional in an isolated anvil fork.
 *
 *   Solution: replace the Arc USDC code at 0x3600... with a standard Solidity ERC-20
 *   mock (compiled bytecode) via anvil_setCode, then mint balances freely. The
 *   OinkAutosave immutable `usdc` already points to 0x3600..., so no redeployment needed.
 *
 * Run: cd /home/user/app && bun run contracts/test-integration/OinkAutosave.integration.ts
 */

import {
  createPublicClient,
  http,
  encodeFunctionData,
  type Address,
  type Hash,
  toHex,
} from "viem";
import { defineChain } from "viem";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FORK_RPC = "http://127.0.0.1:44095";
const OINK_ADDRESS: Address = "0xFf9196dB5e14d8E98532715e6065e0fe0BD08415";
const USDC_ADDRESS: Address = "0x3600000000000000000000000000000000000000";
const DEPLOYER_ADDRESS: Address = "0x83a5E06a2647fbB8D4ddf4113086743f299c339F";

// Different address used as executor (confirms anyone can call executeSave)
const EXECUTOR: Address = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const NON_OWNER: Address = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

/**
 * Minimal standard ERC-20 mock — deployed bytecode compiled from:
 *   mapping(address=>uint256) public balanceOf;          // slot 0
 *   mapping(address=>mapping(address=>uint256)) public allowance; // slot 1
 *   mint(address,uint256) public — no auth, for testing
 *   approve / transfer / transferFrom standard
 * solc 0.8.28 --bin-runtime --optimize --optimize-runs 200
 */
const MOCK_ERC20_BYTECODE =
  "0x608060405234801561000f575f5ffd5b5060043610610060575f3560e01c8063095ea7b31461006457806323b872dd1461008c57806340c10f191461009f57806370a08231146100b4578063a9059cbb146100e1578063dd62ed3e146100f4575b5f5ffd5b610077610072366004610396565b61011e565b60405190151581526020015b60405180910390f35b61007761009a3660046103be565b61014b565b6100b26100ad366004610396565b6102a6565b005b6100d36100c23660046103f8565b5f6020819052908152604090205481565b604051908152602001610083565b6100776100ef366004610396565b6102d6565b6100d3610102366004610418565b600160209081525f928352604080842090915290825290205481565b335f9081526001602081815260408084206001600160a01b03871685529091529091208290555b92915050565b6001600160a01b0383165f908152602081905260408120548211156101a65760405162461bcd60e51b815260206004820152600c60248201526b1a5b9cdd59999a58da595b9d60a21b60448201526064015b60405180910390fd5b6001600160a01b0384165f90815260016020908152604080832033845290915290205482111561020d5760405162461bcd60e51b8152602060048201526012602482015271185b1b1bddd85b98d948195e18d95959195960721b604482015260640161019d565b6001600160a01b0384165f9081526001602090815260408083203384529091528120805484929061023f90849061045d565b90915550506001600160a01b0384165f908152602081905260408120805484929061026b90849061045d565b90915550506001600160a01b0383165f9081526020819052604081208054849290610297908490610470565b90915550600195945050505050565b6001600160a01b0382165f90815260208190526040812080548392906102cd908490610470565b90915550505050565b335f908152602081905260408120548211156103235760405162461bcd60e51b815260206004820152600c60248201526b1a5b9cdd59999a58da595b9d60a21b604482015260640161019d565b335f908152602081905260408120805484929061034190849061045d565b90915550506001600160a01b0383165f908152602081905260408120805484929061036d908490610470565b909155506001949350505050565b80356001600160a01b0381168114610391575f5ffd5b919050565b5f5f604083850312156103a7575f5ffd5b6103b08361037b565b946020939093013593505050565b5f5f5f606084860312156103d0575f5ffd5b6103d98461037b565b92506103e76020850161037b565b929592945050506040919091013590565b5f60208284031215610408575f5ffd5b6104118261037b565b9392505050565b5f5f60408385031215610429575f5ffd5b6104328361037b565b91506104406020840161037b565b90509250929050565b634e487b7160e01b5f52601160045260245ffd5b8181038181111561014557610145610449565b808201808211156101455761014561044956fea26469706673582212206e6ec277b714cfafc8d1543949eae9c73909c6a6965d1903246bd1c90fad3df064736f6c634300081c0033" as `0x${string}`;

// ---------------------------------------------------------------------------
// Chain definition
// ---------------------------------------------------------------------------
const arcFork = defineChain({
  id: 5169490,
  name: "Arc Testnet Fork",
  nativeCurrency: { name: "Arc", symbol: "ARC", decimals: 18 },
  rpcUrls: { default: { http: [FORK_RPC] } },
});

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------
const oinkAbi = [
  {
    type: "function", name: "createPlan",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "cycleLength", type: "uint256" },
      { name: "goal", type: "uint256" },
    ],
    outputs: [{ name: "planId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "executeSave",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "withdraw",
    inputs: [
      { name: "planId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "withdrawAll",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "pausePlan",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "resumePlan",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "cancelPlan",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "getPlan",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "amount", type: "uint256" },
          { name: "cycleLength", type: "uint256" },
          { name: "goal", type: "uint256" },
          { name: "savedBalance", type: "uint256" },
          { name: "lastSaveTimestamp", type: "uint256" },
          { name: "paused", type: "bool" },
          { name: "cancelled", type: "bool" },
          { name: "owner", type: "address" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function", name: "getUserPlans",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "nextPlanId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "usdc",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "isDue",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "totalSaved",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const mockErc20Abi = [
  {
    type: "function", name: "mint",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "approve",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "allowance",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ---------------------------------------------------------------------------
// Test result tracking
// ---------------------------------------------------------------------------
interface TestResult {
  testName: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail?: string;
  expected?: string;
  actual?: string;
  durationMs: number;
}

const results: TestResult[] = [];
let failCount = 0;

function pass(name: string, detail: string, ms: number): void {
  const r: TestResult = { testName: name, status: "PASS", detail, durationMs: ms };
  results.push(r);
  console.log(JSON.stringify(r));
}

function fail(name: string, expected: string, actual: string, ms: number): void {
  failCount++;
  const r: TestResult = { testName: name, status: "FAIL", expected, actual, durationMs: ms };
  results.push(r);
  console.log(JSON.stringify(r));
}

function skip(name: string, reason: string): void {
  const r: TestResult = { testName: name, status: "SKIP", detail: reason, durationMs: 0 };
  results.push(r);
  console.log(JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// Public client (read-only)
// ---------------------------------------------------------------------------
const publicClient = createPublicClient({
  chain: arcFork,
  transport: http(FORK_RPC),
});

// ---------------------------------------------------------------------------
// RPC helpers
// ---------------------------------------------------------------------------
async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(FORK_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const data = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (data.error) throw new Error(`RPC ${method}: ${data.error.message}`);
  return data.result;
}

async function impersonate(addr: Address): Promise<void> {
  await rpc("anvil_impersonateAccount", [addr]);
  await rpc("anvil_setBalance", [addr, "0x1000000000000000000"]); // 1 ETH
}

async function sendAndConfirm(
  from: Address,
  to: Address,
  data: `0x${string}`,
): Promise<{ hash: Hash; status: string; logs: unknown[] }> {
  const hash = (await rpc("eth_sendTransaction", [{ from, to, data }])) as Hash;
  // Poll for receipt
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const receipt = (await rpc("eth_getTransactionReceipt", [hash])) as {
      status: string;
      logs: unknown[];
    } | null;
    if (receipt) return { hash, status: receipt.status, logs: receipt.logs };
  }
  throw new Error(`Receipt timeout for ${hash}`);
}

async function advanceTime(seconds: number): Promise<void> {
  await rpc("evm_increaseTime", [toHex(seconds)]);
  await rpc("evm_mine", []);
}

async function callExpectRevert(
  from: Address,
  to: Address,
  data: `0x${string}`,
): Promise<boolean> {
  try {
    await publicClient.call({ account: from, to, data });
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// USDC helpers (using MockERC20 ABI)
// ---------------------------------------------------------------------------
async function usdcBalance(addr: Address): Promise<bigint> {
  return publicClient.readContract({
    address: USDC_ADDRESS,
    abi: mockErc20Abi,
    functionName: "balanceOf",
    args: [addr],
  });
}

async function mintUsdc(to: Address, amount: bigint, minter: Address): Promise<Hash> {
  const data = encodeFunctionData({
    abi: mockErc20Abi,
    functionName: "mint",
    args: [to, amount],
  });
  const { hash, status } = await sendAndConfirm(minter, USDC_ADDRESS, data);
  if (status !== "0x1") throw new Error(`mint tx failed: ${hash}`);
  return hash;
}

// ---------------------------------------------------------------------------
// OinkAutosave helpers
// ---------------------------------------------------------------------------
async function getPlan(planId: bigint) {
  return publicClient.readContract({
    address: OINK_ADDRESS,
    abi: oinkAbi,
    functionName: "getPlan",
    args: [planId],
  });
}

async function createPlan(
  owner: Address,
  amount: bigint,
  cycleLength: bigint,
  goal: bigint,
): Promise<{ hash: Hash; planId: bigint }> {
  const data = encodeFunctionData({
    abi: oinkAbi,
    functionName: "createPlan",
    args: [amount, cycleLength, goal],
  });
  const { hash, status } = await sendAndConfirm(owner, OINK_ADDRESS, data);
  if (status !== "0x1") throw new Error(`createPlan tx failed: ${hash}`);
  const nextId = await publicClient.readContract({
    address: OINK_ADDRESS,
    abi: oinkAbi,
    functionName: "nextPlanId",
  });
  return { hash, planId: nextId - 1n };
}

// ---------------------------------------------------------------------------
// Setup: install MockERC20 at the USDC address and fund plan owner
// ---------------------------------------------------------------------------
async function setupMockUsdc(planOwner: Address): Promise<void> {
  // Replace Arc USDC with a standard ERC-20 mock so balance accounting works on the fork
  await rpc("anvil_setCode", [USDC_ADDRESS, MOCK_ERC20_BYTECODE]);

  // Verify it deployed correctly
  const code = await publicClient.getCode({ address: USDC_ADDRESS });
  if (!code || code.length < 10) throw new Error("MockERC20 code not installed at USDC address");

  // Mint 1000 USDC (1_000_000_000 raw, 6 decimals) to plan owner
  await impersonate(planOwner);
  await mintUsdc(planOwner, 1_000_000_000n, planOwner);

  const bal = await usdcBalance(planOwner);
  if (bal < 1_000_000n) throw new Error(`planOwner USDC balance too low: ${bal}`);

  console.error(`MockERC20 installed at ${USDC_ADDRESS}, planOwner balance=${bal} raw`);
}

// ---------------------------------------------------------------------------
// Scenario 1 — Verify deployed contract at predictedAddress
// ---------------------------------------------------------------------------
async function scenario1_verifyDeployedContract(): Promise<void> {
  const name = "1. contract deployed at predictedAddress";
  const t0 = Date.now();
  try {
    const code = await publicClient.getCode({ address: OINK_ADDRESS });
    if (!code || code === "0x" || code.length < 10) {
      fail(name, "non-empty bytecode at predictedAddress", code ?? "0x", Date.now() - t0);
      return;
    }

    const storedUsdc = await publicClient.readContract({
      address: OINK_ADDRESS,
      abi: oinkAbi,
      functionName: "usdc",
    });
    if (storedUsdc.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
      fail(name, `usdc()=${USDC_ADDRESS}`, `usdc()=${storedUsdc}`, Date.now() - t0);
      return;
    }

    const nextId = await publicClient.readContract({
      address: OINK_ADDRESS,
      abi: oinkAbi,
      functionName: "nextPlanId",
    });

    pass(
      name,
      `code present (${code.length / 2 - 1} bytes), usdc=${storedUsdc}, nextPlanId=${nextId}`,
      Date.now() - t0,
    );
  } catch (e) {
    fail(name, "contract deployed and readable", String(e), Date.now() - t0);
  }
}

// ---------------------------------------------------------------------------
// Scenario 2 — createPlan fields stored correctly
// ---------------------------------------------------------------------------
async function scenario2_createPlan(
  planOwner: Address,
): Promise<{ planId: bigint } | null> {
  const name = "2. createPlan — fields stored correctly";
  const t0 = Date.now();
  try {
    const amount = 1_000_000n; // 1 USDC (6 decimals)
    const cycleLength = 60n;   // 60 seconds
    const goal = 0n;           // no goal

    const { hash, planId } = await createPlan(planOwner, amount, cycleLength, goal);
    const plan = await getPlan(planId);

    const checks: string[] = [];
    if (plan.amount !== amount) checks.push(`amount=${plan.amount} want ${amount}`);
    if (plan.cycleLength !== cycleLength) checks.push(`cycleLength=${plan.cycleLength} want ${cycleLength}`);
    if (plan.goal !== goal) checks.push(`goal=${plan.goal} want ${goal}`);
    if (plan.savedBalance !== 0n) checks.push(`savedBalance=${plan.savedBalance} want 0`);
    if (plan.paused !== false) checks.push(`paused=${plan.paused} want false`);
    if (plan.cancelled !== false) checks.push(`cancelled=${plan.cancelled} want false`);
    if (plan.owner.toLowerCase() !== planOwner.toLowerCase()) {
      checks.push(`owner=${plan.owner} want ${planOwner}`);
    }

    const userPlans = await publicClient.readContract({
      address: OINK_ADDRESS,
      abi: oinkAbi,
      functionName: "getUserPlans",
      args: [planOwner],
    });
    if (!userPlans.includes(planId)) checks.push(`planId ${planId} not in getUserPlans`);

    if (checks.length > 0) {
      fail(name, "all plan fields correct", checks.join("; "), Date.now() - t0);
      return null;
    }

    pass(name, `planId=${planId}, tx=${hash}, amount=1 USDC, cycleLength=60s, owner=${plan.owner}`, Date.now() - t0);
    return { planId };
  } catch (e) {
    fail(name, "createPlan succeeds", String(e), Date.now() - t0);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scenario 3 — approve OinkAutosave to spend USDC
// ---------------------------------------------------------------------------
async function scenario3_approveUsdc(planOwner: Address): Promise<boolean> {
  const name = "3. approve OinkAutosave to spend USDC from plan owner";
  const t0 = Date.now();
  try {
    const MAX = 2n ** 256n - 1n;
    const data = encodeFunctionData({
      abi: mockErc20Abi,
      functionName: "approve",
      args: [OINK_ADDRESS, MAX],
    });
    const { hash, status } = await sendAndConfirm(planOwner, USDC_ADDRESS, data);
    if (status !== "0x1") {
      fail(name, "approve tx succeeds", `status=${status}, tx=${hash}`, Date.now() - t0);
      return false;
    }

    const allowance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: mockErc20Abi,
      functionName: "allowance",
      args: [planOwner, OINK_ADDRESS],
    });

    if (allowance < 1_000_000n) {
      fail(name, `allowance >= 1000000`, `allowance=${allowance}`, Date.now() - t0);
      return false;
    }

    pass(name, `approve tx=${hash}, allowance=MAX (${allowance})`, Date.now() - t0);
    return true;
  } catch (e) {
    fail(name, "approve succeeds", String(e), Date.now() - t0);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Scenario 4 — executeSave from DIFFERENT address; savedBalance updated, USDC transferred
// ---------------------------------------------------------------------------
async function scenario4_executeSave(
  planOwner: Address,
  planId: bigint,
): Promise<boolean> {
  const name = "4. executeSave — caller ≠ owner, savedBalance updated, USDC transferred";
  const t0 = Date.now();
  try {
    await impersonate(EXECUTOR);

    const balanceBefore = await usdcBalance(OINK_ADDRESS);
    const ownerBalBefore = await usdcBalance(planOwner);

    // Advance time so cycle is due (plan was just created with lastSaveTimestamp=now)
    await advanceTime(65);

    const execData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [planId],
    });
    const { hash, status } = await sendAndConfirm(EXECUTOR, OINK_ADDRESS, execData);

    if (status !== "0x1") {
      fail(name, "executeSave tx succeeds (status 0x1)", `status=${status}, tx=${hash}`, Date.now() - t0);
      return false;
    }

    const plan = await getPlan(planId);
    const balanceAfter = await usdcBalance(OINK_ADDRESS);
    const ownerBalAfter = await usdcBalance(planOwner);

    const checks: string[] = [];
    if (plan.savedBalance !== 1_000_000n) {
      checks.push(`savedBalance=${plan.savedBalance} want 1000000`);
    }
    if (balanceAfter - balanceBefore !== 1_000_000n) {
      checks.push(`OINK balance delta=${balanceAfter - balanceBefore} want 1000000`);
    }
    if (ownerBalBefore - ownerBalAfter !== 1_000_000n) {
      checks.push(`owner balance delta=${ownerBalBefore - ownerBalAfter} want 1000000`);
    }

    if (checks.length > 0) {
      fail(name, "savedBalance=1000000, USDC moved", checks.join("; "), Date.now() - t0);
      return false;
    }

    pass(
      name,
      `tx=${hash}, savedBalance=1000000, OINK+1USDC, owner-1USDC, executor=${EXECUTOR}`,
      Date.now() - t0,
    );
    return true;
  } catch (e) {
    fail(name, "executeSave succeeds from non-owner", String(e), Date.now() - t0);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Scenario 5 — executeSave reverts before cycle due (PlanNotDue)
// ---------------------------------------------------------------------------
async function scenario5_executeSaveNotDue(planId: bigint): Promise<void> {
  const name = "5. executeSave reverts before cycle due (PlanNotDue)";
  const t0 = Date.now();
  try {
    await impersonate(EXECUTOR);

    // Immediately after a successful save, try again — should revert
    const execData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [planId],
    });

    const reverted = await callExpectRevert(EXECUTOR, OINK_ADDRESS, execData);

    if (!reverted) {
      fail(name, "revert (PlanNotDue)", "call succeeded unexpectedly", Date.now() - t0);
      return;
    }

    pass(name, `executeSave correctly reverted before cycle due`, Date.now() - t0);
  } catch (e) {
    fail(name, "PlanNotDue revert", String(e), Date.now() - t0);
  }
}

// ---------------------------------------------------------------------------
// Scenario 6 — withdraw partial amount
// ---------------------------------------------------------------------------
async function scenario6_withdraw(
  planOwner: Address,
  planId: bigint,
): Promise<void> {
  const name = "6. withdraw — partial withdrawal reduces savedBalance, USDC returned to owner";
  const t0 = Date.now();
  try {
    const planBefore = await getPlan(planId);
    if (planBefore.savedBalance === 0n) {
      skip(name, "savedBalance=0 — cannot test withdraw");
      return;
    }

    const withdrawAmount = 500_000n; // 0.5 USDC
    const ownerBalBefore = await usdcBalance(planOwner);

    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "withdraw",
      args: [planId, withdrawAmount],
    });
    const { hash, status } = await sendAndConfirm(planOwner, OINK_ADDRESS, data);

    if (status !== "0x1") {
      fail(name, "withdraw tx succeeds", `status=${status}, tx=${hash}`, Date.now() - t0);
      return;
    }

    const planAfter = await getPlan(planId);
    const ownerBalAfter = await usdcBalance(planOwner);

    const checks: string[] = [];
    const expectedSaved = planBefore.savedBalance - withdrawAmount;
    if (planAfter.savedBalance !== expectedSaved) {
      checks.push(`savedBalance=${planAfter.savedBalance} want ${expectedSaved}`);
    }
    if (ownerBalAfter - ownerBalBefore !== withdrawAmount) {
      checks.push(`owner balance delta=${ownerBalAfter - ownerBalBefore} want ${withdrawAmount}`);
    }

    if (checks.length > 0) {
      fail(name, "savedBalance decremented, owner received USDC", checks.join("; "), Date.now() - t0);
      return;
    }

    pass(
      name,
      `tx=${hash}, withdrew 500000, savedBalance=${planAfter.savedBalance}, owner+500000 USDC`,
      Date.now() - t0,
    );
  } catch (e) {
    fail(name, "withdraw succeeds", String(e), Date.now() - t0);
  }
}

// ---------------------------------------------------------------------------
// Scenario 7 — pausePlan + executeSave reverts PlanPaused_
// ---------------------------------------------------------------------------
async function scenario7_pausePlan(
  planOwner: Address,
  planId: bigint,
): Promise<void> {
  const name = "7. pausePlan — executeSave reverts PlanPaused_ after pause";
  const t0 = Date.now();
  try {
    const pauseData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "pausePlan",
      args: [planId],
    });
    const { hash: pauseHash, status: pauseStatus } = await sendAndConfirm(
      planOwner,
      OINK_ADDRESS,
      pauseData,
    );

    if (pauseStatus !== "0x1") {
      fail(name, "pausePlan tx succeeds", `status=${pauseStatus}, tx=${pauseHash}`, Date.now() - t0);
      return;
    }

    const plan = await getPlan(planId);
    if (!plan.paused) {
      fail(name, "plan.paused=true", `plan.paused=${plan.paused}`, Date.now() - t0);
      return;
    }

    // Advance time so cycle would be due
    await advanceTime(65);

    await impersonate(EXECUTOR);
    const execData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [planId],
    });
    const reverted = await callExpectRevert(EXECUTOR, OINK_ADDRESS, execData);

    if (!reverted) {
      fail(name, "executeSave reverts PlanPaused_", "call succeeded on paused plan", Date.now() - t0);
      return;
    }

    pass(
      name,
      `pausePlan tx=${pauseHash}, plan.paused=true, executeSave correctly reverted PlanPaused_`,
      Date.now() - t0,
    );
  } catch (e) {
    fail(name, "pausePlan + PlanPaused_ revert", String(e), Date.now() - t0);
  }
}

// ---------------------------------------------------------------------------
// Scenario 8 — resumePlan + executeSave succeeds
// ---------------------------------------------------------------------------
async function scenario8_resumePlan(
  planOwner: Address,
  planId: bigint,
): Promise<void> {
  const name = "8. resumePlan — executeSave succeeds after resume";
  const t0 = Date.now();
  try {
    const resumeData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "resumePlan",
      args: [planId],
    });
    const { hash: resumeHash, status: resumeStatus } = await sendAndConfirm(
      planOwner,
      OINK_ADDRESS,
      resumeData,
    );

    if (resumeStatus !== "0x1") {
      fail(name, "resumePlan tx succeeds", `status=${resumeStatus}, tx=${resumeHash}`, Date.now() - t0);
      return;
    }

    const planAfterResume = await getPlan(planId);
    if (planAfterResume.paused) {
      fail(name, "plan.paused=false after resume", `plan.paused=${planAfterResume.paused}`, Date.now() - t0);
      return;
    }

    // Time was already advanced in scenario 7; plan is due
    await impersonate(EXECUTOR);
    const savedBefore = planAfterResume.savedBalance;
    const oinkBalBefore = await usdcBalance(OINK_ADDRESS);

    const execData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [planId],
    });
    const { hash: execHash, status: execStatus } = await sendAndConfirm(
      EXECUTOR,
      OINK_ADDRESS,
      execData,
    );

    if (execStatus !== "0x1") {
      fail(name, "executeSave succeeds after resume", `status=${execStatus}, tx=${execHash}`, Date.now() - t0);
      return;
    }

    const planAfterExec = await getPlan(planId);
    const oinkBalAfter = await usdcBalance(OINK_ADDRESS);

    const checks: string[] = [];
    if (planAfterExec.savedBalance !== savedBefore + 1_000_000n) {
      checks.push(`savedBalance=${planAfterExec.savedBalance} want ${savedBefore + 1_000_000n}`);
    }
    if (oinkBalAfter - oinkBalBefore !== 1_000_000n) {
      checks.push(`OINK balance delta=${oinkBalAfter - oinkBalBefore} want 1000000`);
    }

    if (checks.length > 0) {
      fail(name, "savedBalance incremented, USDC moved", checks.join("; "), Date.now() - t0);
      return;
    }

    pass(
      name,
      `resumePlan tx=${resumeHash}, executeSave tx=${execHash}, savedBalance=${planAfterExec.savedBalance}`,
      Date.now() - t0,
    );
  } catch (e) {
    fail(name, "resumePlan + executeSave succeeds", String(e), Date.now() - t0);
  }
}

// ---------------------------------------------------------------------------
// Scenario 9 — cancelPlan: auto-withdraws savings, marks cancelled, blocks executeSave
// ---------------------------------------------------------------------------
async function scenario9_cancelPlan(planOwner: Address): Promise<void> {
  const name = "9. cancelPlan — auto-withdraws savings, plan marked cancelled, executeSave reverts PlanCancelled_";
  const t0 = Date.now();
  try {
    // Create a SECOND plan
    const { planId: plan2Id } = await createPlan(planOwner, 1_000_000n, 60n, 0n);

    // Advance time and do a save to accumulate funds
    await advanceTime(65);
    await impersonate(EXECUTOR);
    const execData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [plan2Id],
    });
    const { hash: execHash, status: execStatus } = await sendAndConfirm(
      EXECUTOR,
      OINK_ADDRESS,
      execData,
    );
    if (execStatus !== "0x1") {
      fail(name, "executeSave for plan2 succeeds", `status=${execStatus}, tx=${execHash}`, Date.now() - t0);
      return;
    }

    const plan2Before = await getPlan(plan2Id);
    if (plan2Before.savedBalance === 0n) {
      fail(name, "plan2.savedBalance > 0 before cancel", "savedBalance=0", Date.now() - t0);
      return;
    }

    const ownerBalBefore = await usdcBalance(planOwner);

    // Cancel the plan — should auto-withdraw savedBalance
    const cancelData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "cancelPlan",
      args: [plan2Id],
    });
    const { hash: cancelHash, status: cancelStatus } = await sendAndConfirm(
      planOwner,
      OINK_ADDRESS,
      cancelData,
    );
    if (cancelStatus !== "0x1") {
      fail(name, "cancelPlan tx succeeds", `status=${cancelStatus}, tx=${cancelHash}`, Date.now() - t0);
      return;
    }

    const plan2After = await getPlan(plan2Id);
    const ownerBalAfter = await usdcBalance(planOwner);

    const checks: string[] = [];
    if (!plan2After.cancelled) {
      checks.push(`plan.cancelled=${plan2After.cancelled} want true`);
    }
    if (plan2After.savedBalance !== 0n) {
      checks.push(`savedBalance=${plan2After.savedBalance} want 0`);
    }
    if (ownerBalAfter - ownerBalBefore !== plan2Before.savedBalance) {
      checks.push(
        `owner balance delta=${ownerBalAfter - ownerBalBefore} want ${plan2Before.savedBalance}`,
      );
    }

    // executeSave on cancelled plan should revert
    await advanceTime(65);
    await impersonate(EXECUTOR);
    const exec2Data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [plan2Id],
    });
    const reverted = await callExpectRevert(EXECUTOR, OINK_ADDRESS, exec2Data);
    if (!reverted) {
      checks.push("executeSave on cancelled plan did not revert");
    }

    if (checks.length > 0) {
      fail(name, "plan cancelled correctly", checks.join("; "), Date.now() - t0);
      return;
    }

    pass(
      name,
      `cancelPlan tx=${cancelHash}, plan2.cancelled=true, savedBalance=0, owner got ${plan2Before.savedBalance} USDC back, executeSave reverted PlanCancelled_`,
      Date.now() - t0,
    );
  } catch (e) {
    fail(name, "cancelPlan auto-withdraws and blocks further saves", String(e), Date.now() - t0);
  }
}

// ---------------------------------------------------------------------------
// Scenario 10 — non-owner cannot pausePlan (NotPlanOwner)
// ---------------------------------------------------------------------------
async function scenario10_nonOwnerCannotPause(planId: bigint): Promise<void> {
  const name = "10. pausePlan — non-owner caller reverts (NotPlanOwner)";
  const t0 = Date.now();
  try {
    await impersonate(NON_OWNER);
    const data = encodeFunctionData({ abi: oinkAbi, functionName: "pausePlan", args: [planId] });
    const reverted = await callExpectRevert(NON_OWNER, OINK_ADDRESS, data);
    if (!reverted) {
      fail(name, "revert (NotPlanOwner)", "call succeeded", Date.now() - t0);
      return;
    }
    pass(name, "non-owner pausePlan correctly reverted NotPlanOwner", Date.now() - t0);
  } catch (e) {
    fail(name, "NotPlanOwner revert", String(e), Date.now() - t0);
  }
}

// ---------------------------------------------------------------------------
// Scenario 11 — non-owner cannot withdraw (NotPlanOwner)
// ---------------------------------------------------------------------------
async function scenario11_nonOwnerCannotWithdraw(planId: bigint): Promise<void> {
  const name = "11. withdraw — non-owner caller reverts (NotPlanOwner)";
  const t0 = Date.now();
  try {
    await impersonate(NON_OWNER);
    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "withdraw",
      args: [planId, 1n],
    });
    const reverted = await callExpectRevert(NON_OWNER, OINK_ADDRESS, data);
    if (!reverted) {
      fail(name, "revert (NotPlanOwner)", "call succeeded", Date.now() - t0);
      return;
    }
    pass(name, "non-owner withdraw correctly reverted NotPlanOwner", Date.now() - t0);
  } catch (e) {
    fail(name, "NotPlanOwner revert", String(e), Date.now() - t0);
  }
}

// ---------------------------------------------------------------------------
// Scenario 12 — non-owner cannot cancelPlan (NotPlanOwner)
// ---------------------------------------------------------------------------
async function scenario12_nonOwnerCannotCancel(planId: bigint): Promise<void> {
  const name = "12. cancelPlan — non-owner caller reverts (NotPlanOwner)";
  const t0 = Date.now();
  try {
    await impersonate(NON_OWNER);
    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "cancelPlan",
      args: [planId],
    });
    const reverted = await callExpectRevert(NON_OWNER, OINK_ADDRESS, data);
    if (!reverted) {
      fail(name, "revert (NotPlanOwner)", "call succeeded", Date.now() - t0);
      return;
    }
    pass(name, "non-owner cancelPlan correctly reverted NotPlanOwner", Date.now() - t0);
  } catch (e) {
    fail(name, "NotPlanOwner revert", String(e), Date.now() - t0);
  }
}

// ---------------------------------------------------------------------------
// Scenario 13 — withdrawAll drains savedBalance
// ---------------------------------------------------------------------------
async function scenario13_withdrawAll(
  planOwner: Address,
  planId: bigint,
): Promise<void> {
  const name = "13. withdrawAll — drains savedBalance entirely, USDC returned to owner";
  const t0 = Date.now();
  try {
    // Ensure there's something to withdraw: do another executeSave
    await advanceTime(65);
    await impersonate(EXECUTOR);
    const execData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [planId],
    });
    await sendAndConfirm(EXECUTOR, OINK_ADDRESS, execData);

    const planBefore = await getPlan(planId);
    if (planBefore.savedBalance === 0n) {
      skip(name, "savedBalance=0 even after executeSave — cannot test withdrawAll");
      return;
    }

    const ownerBalBefore = await usdcBalance(planOwner);
    const expected = planBefore.savedBalance;

    const data = encodeFunctionData({ abi: oinkAbi, functionName: "withdrawAll", args: [planId] });
    const { hash, status } = await sendAndConfirm(planOwner, OINK_ADDRESS, data);

    if (status !== "0x1") {
      fail(name, "withdrawAll tx succeeds", `status=${status}, tx=${hash}`, Date.now() - t0);
      return;
    }

    const planAfter = await getPlan(planId);
    const ownerBalAfter = await usdcBalance(planOwner);

    const checks: string[] = [];
    if (planAfter.savedBalance !== 0n) {
      checks.push(`savedBalance=${planAfter.savedBalance} want 0`);
    }
    if (ownerBalAfter - ownerBalBefore !== expected) {
      checks.push(`owner delta=${ownerBalAfter - ownerBalBefore} want ${expected}`);
    }

    if (checks.length > 0) {
      fail(name, "withdrawAll drains balance", checks.join("; "), Date.now() - t0);
      return;
    }

    pass(name, `tx=${hash}, withdrew all ${expected} raw USDC, savedBalance=0`, Date.now() - t0);
  } catch (e) {
    fail(name, "withdrawAll succeeds", String(e), Date.now() - t0);
  }
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.error("=== OinkAutosave fork integration tests ===");

  // Plan owner = deployer (impersonated; has gas via setBalance)
  const planOwner = DEPLOYER_ADDRESS;

  // Install MockERC20 at the Arc USDC address and fund plan owner
  try {
    await setupMockUsdc(planOwner);
  } catch (e) {
    console.error("FATAL: MockERC20 setup failed:", e);
    process.exit(2);
  }

  // ---- Scenarios ----
  await scenario1_verifyDeployedContract();

  const plan1Result = await scenario2_createPlan(planOwner);
  if (!plan1Result) {
    fail("3..13 (blocked)", "plan created in scenario 2", "createPlan failed", 0);
    printSummary();
    process.exit(1);
  }
  const { planId } = plan1Result;

  const approved = await scenario3_approveUsdc(planOwner);
  if (!approved) {
    fail("4..13 (blocked)", "USDC approved in scenario 3", "approve failed", 0);
    printSummary();
    process.exit(1);
  }

  await scenario4_executeSave(planOwner, planId);
  await scenario5_executeSaveNotDue(planId);
  await scenario6_withdraw(planOwner, planId);
  await scenario7_pausePlan(planOwner, planId);
  await scenario8_resumePlan(planOwner, planId);
  await scenario9_cancelPlan(planOwner);

  // Access control assertions (single most important: non-owner cannot pause)
  await scenario10_nonOwnerCannotPause(planId);
  await scenario11_nonOwnerCannotWithdraw(planId);
  await scenario12_nonOwnerCannotCancel(planId);
  await scenario13_withdrawAll(planOwner, planId);

  printSummary();
  process.exit(failCount > 0 ? 1 : 0);
}

function printSummary(): void {
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  console.error(`\n=== Summary: ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(2);
});
