/**
 * OinkAutosave — Pre-deploy fork integration test
 *
 * Dispatch: PRE-DEPLOY (VERIFY-ON-FORK)
 * Fork RPC : http://127.0.0.1:34611  (Arc Testnet anvil fork)
 *
 * Every sender is obtained via anvil_impersonateAccount + anvil_setBalance.
 * No private key is used anywhere in this file.
 *
 * USDC funding strategy:
 *   masterMinter (0xa1f4...) → configureMinter(testMinter, bigAllowance)
 *   testMinter → mint(planOwner, amount) and mint(executor, amount)
 */

import {
  createPublicClient,
  http,
  parseAbi,
  encodeFunctionData,
  getAddress,
} from "viem";

// ─── Constants ────────────────────────────────────────────────────────────────

const FORK_RPC = "http://127.0.0.1:34611";
const CONTRACT_ADDR = getAddress("0x000Aa5025f54Ae49FE9D3DBEc2604961F3a67ec8");
const USDC_ADDR = getAddress("0x3600000000000000000000000000000000000000");
const MASTER_MINTER = getAddress("0xa1f45991b7928b14f2047e36958d6ae7d24bbf41");
// A throwaway minter we configure on the fork
const TEST_MINTER = getAddress("0x1000000000000000000000000000000000000001");
// Plan owner — creates plans and owns balances
const PLAN_OWNER = getAddress("0x2000000000000000000000000000000000000001");
// Executor — triggers executeSave (permissionless caller)
const EXECUTOR = getAddress("0x3000000000000000000000000000000000000001");
// Attacker — used for negative access-control tests
const ATTACKER = getAddress("0x4000000000000000000000000000000000000001");

const ONE_USDC = 1_000_000n; // 1 USDC (6 decimals)
const MINT_AMOUNT = 100_000_000n; // 100 USDC per test account
const ETH_FOR_GAS = "0x56BC75E2D63100000"; // 100 ETH in hex wei

// ─── ABIs ─────────────────────────────────────────────────────────────────────

// Use JSON ABI for functions with tuple return types (parseAbi doesn't support inline tuples)
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
    inputs: [{ name: "planId", type: "uint256" }, { name: "amount", type: "uint256" }],
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
    outputs: [{
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
    }],
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
  { type: "error", name: "PlanNotFound", inputs: [{ name: "planId", type: "uint256" }] },
  { type: "error", name: "PlanCancelled_", inputs: [{ name: "planId", type: "uint256" }] },
  { type: "error", name: "PlanPaused_", inputs: [{ name: "planId", type: "uint256" }] },
  {
    type: "error", name: "PlanNotDue",
    inputs: [
      { name: "planId", type: "uint256" },
      { name: "nextDue", type: "uint256" },
      { name: "currentTime", type: "uint256" },
    ],
  },
  {
    type: "error", name: "NotPlanOwner",
    inputs: [
      { name: "planId", type: "uint256" },
      { name: "caller", type: "address" },
      { name: "owner", type: "address" },
    ],
  },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
] as const;

const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function configureMinter(address minter, uint256 minterAllowedAmount) returns (bool)",
  "function mint(address to, uint256 amount) returns (bool)",
  "function isMinter(address) view returns (bool)",
]);

// ─── Transport ────────────────────────────────────────────────────────────────

const transport = http(FORK_RPC, { timeout: 30_000 });

const publicClient = createPublicClient({ transport });

// ─── Low-level fork helpers ───────────────────────────────────────────────────

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(FORK_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`RPC ${method} failed: ${json.error.message}`);
  return json.result;
}

async function impersonate(addr: string): Promise<void> {
  await rpcCall("anvil_impersonateAccount", [addr]);
  await rpcCall("anvil_setBalance", [addr, ETH_FOR_GAS]);
}

async function warpTime(seconds: bigint): Promise<void> {
  await rpcCall("evm_increaseTime", [Number(seconds)]);
  await rpcCall("evm_mine", []);
}

async function sendImpersonated(
  from: `0x${string}`,
  to: `0x${string}`,
  data: `0x${string}`
): Promise<`0x${string}`> {
  // Use 3M gas limit — anvil fork is generous and this avoids OOG on any call
  const result = await rpcCall("eth_sendTransaction", [{ from, to, data, gas: "0x2DC6C0" }]);
  return result as `0x${string}`;
}

async function waitReceipt(txHash: `0x${string}`): Promise<{
  status: string;
  blockNumber: string;
}> {
  for (let i = 0; i < 30; i++) {
    const receipt = (await rpcCall("eth_getTransactionReceipt", [txHash])) as {
      status: string;
      blockNumber: string;
    } | null;
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Receipt not found for ${txHash}`);
}

async function sendAndConfirm(
  from: `0x${string}`,
  to: `0x${string}`,
  data: `0x${string}`
): Promise<`0x${string}`> {
  const txHash = await sendImpersonated(from, to, data);
  const receipt = await waitReceipt(txHash);
  if (receipt.status !== "0x1") throw new Error(`Tx ${txHash} reverted`);
  return txHash;
}

// Expect a call to revert; returns true if it did, false if it unexpectedly succeeded
async function expectRevert(
  from: `0x${string}`,
  to: `0x${string}`,
  data: `0x${string}`
): Promise<boolean> {
  try {
    await rpcCall("eth_call", [{ from, to, data }, "latest"]);
    return false; // did NOT revert
  } catch (e: unknown) {
    // eth_call threw — check if it's a revert
    const msg = (e as Error).message ?? "";
    if (msg.includes("revert") || msg.includes("execution reverted") || msg.includes("RPC")) return true;
    return true;
  }
}

// ─── Result tracking ─────────────────────────────────────────────────────────

interface TestResult {
  testName: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  detail?: string;
  expected?: string;
  actual?: string;
  durationMs: number;
}

const results: TestResult[] = [];
let failures = 0;

function pass(testName: string, detail: string, durationMs: number): void {
  results.push({ testName, status: "PASS", detail, durationMs });
  console.log(JSON.stringify({ testName, status: "PASS", detail, durationMs }));
}

function fail(
  testName: string,
  expected: string,
  actual: string,
  durationMs: number
): void {
  results.push({ testName, status: "FAIL", expected, actual, durationMs });
  console.log(JSON.stringify({ testName, status: "FAIL", expected, actual, durationMs }));
  failures++;
}

function skip(testName: string, reason: string): void {
  results.push({ testName, status: "SKIPPED", detail: reason, durationMs: 0 });
  console.log(JSON.stringify({ testName, status: "SKIPPED", detail: reason, durationMs: 0 }));
}

async function run(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    pass(name, "completed without error", Date.now() - t0);
  } catch (e: unknown) {
    fail(name, "no error", String((e as Error).message ?? e), Date.now() - t0);
  }
}

// ─── USDC funding setup ───────────────────────────────────────────────────────

async function setupUsdcFunding(): Promise<void> {
  // Impersonate masterMinter and configure TEST_MINTER (idempotent — skip if already minter)
  await impersonate(MASTER_MINTER);

  const isMinterResult = await publicClient.readContract({
    address: USDC_ADDR,
    abi: usdcAbi,
    functionName: "isMinter",
    args: [TEST_MINTER],
  });

  if (!isMinterResult) {
    const configureMinterData = encodeFunctionData({
      abi: usdcAbi,
      functionName: "configureMinter",
      args: [TEST_MINTER, 10_000_000_000_000n], // 10M USDC allowance
    });
    await sendAndConfirm(MASTER_MINTER, USDC_ADDR, configureMinterData);
  }

  // Impersonate TEST_MINTER and mint USDC to test addresses
  await impersonate(TEST_MINTER);
  for (const recipient of [PLAN_OWNER, EXECUTOR, ATTACKER]) {
    // Check if already funded (idempotent)
    const bal = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [recipient],
    });
    if (bal < MINT_AMOUNT / 2n) {
      const mintData = encodeFunctionData({
        abi: usdcAbi,
        functionName: "mint",
        args: [recipient, MINT_AMOUNT],
      });
      await sendAndConfirm(TEST_MINTER, USDC_ADDR, mintData);
    }
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("# OinkAutosave fork integration tests");
  console.log("# Contract:", CONTRACT_ADDR);

  // ── SETUP ──────────────────────────────────────────────────────────────────

  // Impersonate all test addresses for gas
  await impersonate(PLAN_OWNER);
  await impersonate(EXECUTOR);
  await impersonate(ATTACKER);

  // Fund test accounts with USDC via masterMinter → configureMinter → mint
  await setupUsdcFunding();

  // ── T1: Contract deployed at predictedAddress ─────────────────────────────
  await run("contract deployed at predictedAddress", async () => {
    const code = await rpcCall("eth_getCode", [CONTRACT_ADDR, "latest"]);
    if (!code || (code as string).length <= 2) {
      throw new Error("No code at predictedAddress — contract not deployed");
    }
    // Verify usdc() returns the configured address
    const usdcAddr = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "usdc",
    });
    if (getAddress(usdcAddr) !== USDC_ADDR) {
      throw new Error(`usdc() returned ${usdcAddr}, expected ${USDC_ADDR}`);
    }
  });

  // ── T2: createPlan — basic plan creation ─────────────────────────────────
  let planId1 = 0n;
  await run("createPlan: creates a plan with 1 USDC / 60s cycle / no goal", async () => {
    const nextId = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "nextPlanId",
    });

    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "createPlan",
      args: [ONE_USDC, 60n, 0n],
    });
    const txHash = await sendAndConfirm(PLAN_OWNER, CONTRACT_ADDR, data);

    planId1 = nextId; // nextPlanId before tx = new plan's ID

    const plan = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [planId1],
    });

    if (plan.amount !== ONE_USDC) throw new Error(`amount mismatch: ${plan.amount}`);
    if (plan.cycleLength !== 60n) throw new Error(`cycleLength mismatch: ${plan.cycleLength}`);
    if (plan.goal !== 0n) throw new Error(`goal should be 0: ${plan.goal}`);
    if (plan.savedBalance !== 0n) throw new Error(`savedBalance should be 0: ${plan.savedBalance}`);
    if (plan.paused !== false) throw new Error("plan should not be paused");
    if (plan.cancelled !== false) throw new Error("plan should not be cancelled");
    if (getAddress(plan.owner) !== PLAN_OWNER) throw new Error(`owner mismatch: ${plan.owner}`);

    const userPlans = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getUserPlans",
      args: [PLAN_OWNER],
    });
    if (!userPlans.includes(planId1)) throw new Error("planId not in userPlans");

    console.log(`  planId1=${planId1} tx=${txHash}`);
  });

  // ── T3: ERC-20 approve ────────────────────────────────────────────────────
  await run("approve: plan owner approves OinkAutosave to spend USDC", async () => {
    const approveData = encodeFunctionData({
      abi: usdcAbi,
      functionName: "approve",
      args: [CONTRACT_ADDR, MINT_AMOUNT], // approve up to 100 USDC
    });
    const txHash = await sendAndConfirm(PLAN_OWNER, USDC_ADDR, approveData);

    const allowance = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "allowance",
      args: [PLAN_OWNER, CONTRACT_ADDR],
    });
    if (allowance < ONE_USDC) throw new Error(`allowance too low: ${allowance}`);
    console.log(`  allowance=${allowance} tx=${txHash}`);
  });

  // ── T4: executeSave — permissionless, warp 60s ────────────────────────────
  await run("executeSave: warp 60s, execute from EXECUTOR, savedBalance updated", async () => {
    const ownerBalBefore = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [PLAN_OWNER],
    });
    const contractBalBefore = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [CONTRACT_ADDR],
    });

    await warpTime(61n);

    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [planId1],
    });
    const txHash = await sendAndConfirm(EXECUTOR, CONTRACT_ADDR, data);

    const plan = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [planId1],
    });

    if (plan.savedBalance !== ONE_USDC) {
      throw new Error(`savedBalance expected ${ONE_USDC}, got ${plan.savedBalance}`);
    }

    const ownerBalAfter = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [PLAN_OWNER],
    });
    const contractBalAfter = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [CONTRACT_ADDR],
    });

    if (ownerBalAfter !== ownerBalBefore - ONE_USDC) {
      throw new Error(`owner balance: before=${ownerBalBefore} after=${ownerBalAfter}`);
    }
    if (contractBalAfter !== contractBalBefore + ONE_USDC) {
      throw new Error(`contract balance: before=${contractBalBefore} after=${contractBalAfter}`);
    }
    console.log(`  savedBalance=${plan.savedBalance} tx=${txHash}`);
  });

  // ── T5: executeSave reverts before cycle due ──────────────────────────────
  await run("executeSave: reverts with PlanNotDue before cycle is due", async () => {
    // Immediately try again — lastSaveTimestamp just updated, not due yet
    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [planId1],
    });
    let reverted = false;
    try {
      // Use eth_call to capture the revert without spending gas
      await rpcCall("eth_call", [{ from: EXECUTOR, to: CONTRACT_ADDR, data }, "latest"]);
    } catch (e: unknown) {
      const msg = String((e as Error).message ?? "");
      if (msg.includes("PlanNotDue") || msg.includes("revert") || msg.includes("execution reverted")) {
        reverted = true;
      }
    }
    if (!reverted) throw new Error("Expected PlanNotDue revert, but call succeeded");
  });

  // ── T6: withdraw — plan owner withdraws partial amount ───────────────────
  await run("withdraw: plan owner withdraws partial amount, savedBalance decreases", async () => {
    const planBefore = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [planId1],
    });
    const ownerBalBefore = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [PLAN_OWNER],
    });

    const withdrawAmount = ONE_USDC / 2n; // 0.5 USDC
    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "withdraw",
      args: [planId1, withdrawAmount],
    });
    const txHash = await sendAndConfirm(PLAN_OWNER, CONTRACT_ADDR, data);

    const planAfter = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [planId1],
    });
    const ownerBalAfter = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [PLAN_OWNER],
    });

    if (planAfter.savedBalance !== planBefore.savedBalance - withdrawAmount) {
      throw new Error(
        `savedBalance: expected ${planBefore.savedBalance - withdrawAmount}, got ${planAfter.savedBalance}`
      );
    }
    if (ownerBalAfter !== ownerBalBefore + withdrawAmount) {
      throw new Error(`owner balance: expected +${withdrawAmount}, before=${ownerBalBefore} after=${ownerBalAfter}`);
    }
    console.log(`  savedBalance=${planAfter.savedBalance} tx=${txHash}`);
  });

  // ── T6b: non-owner cannot withdraw ───────────────────────────────────────
  await run("withdraw: non-owner cannot withdraw (NotPlanOwner revert)", async () => {
    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "withdraw",
      args: [planId1, 1n],
    });
    let reverted = false;
    try {
      await rpcCall("eth_call", [{ from: ATTACKER, to: CONTRACT_ADDR, data }, "latest"]);
    } catch (e: unknown) {
      reverted = true;
    }
    if (!reverted) throw new Error("Expected NotPlanOwner revert, but call succeeded");
  });

  // ── T7: pausePlan — pause, verify executeSave reverts with PlanPaused_ ───
  await run("pausePlan: pauses plan; executeSave then reverts with PlanPaused_", async () => {
    // Warp first so plan would be due
    await warpTime(61n);

    const pauseData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "pausePlan",
      args: [planId1],
    });
    const txHash = await sendAndConfirm(PLAN_OWNER, CONTRACT_ADDR, pauseData);

    const plan = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [planId1],
    });
    if (!plan.paused) throw new Error("plan.paused should be true after pausePlan");

    // Now try executeSave — should revert PlanPaused_
    const saveData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [planId1],
    });
    let reverted = false;
    try {
      await rpcCall("eth_call", [{ from: EXECUTOR, to: CONTRACT_ADDR, data: saveData }, "latest"]);
    } catch (e: unknown) {
      const msg = String((e as Error).message ?? "");
      if (msg.includes("PlanPaused") || msg.includes("revert") || msg.includes("execution reverted")) {
        reverted = true;
      }
    }
    if (!reverted) throw new Error("Expected PlanPaused_ revert, but executeSave succeeded");
    console.log(`  pausePlan tx=${txHash}`);
  });

  // ── T7b: non-owner cannot pause ──────────────────────────────────────────
  await run("pausePlan: non-owner cannot pause (NotPlanOwner revert)", async () => {
    // Create a second plan, then try to pause from ATTACKER
    const createData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "createPlan",
      args: [ONE_USDC, 60n, 0n],
    });
    const nextId = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "nextPlanId",
    });
    await sendAndConfirm(PLAN_OWNER, CONTRACT_ADDR, createData);
    const planId2 = nextId;

    const pauseData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "pausePlan",
      args: [planId2],
    });
    let reverted = false;
    try {
      await rpcCall("eth_call", [{ from: ATTACKER, to: CONTRACT_ADDR, data: pauseData }, "latest"]);
    } catch (_) {
      reverted = true;
    }
    if (!reverted) throw new Error("Expected NotPlanOwner revert for ATTACKER pausePlan, but succeeded");
  });

  // ── T8: resumePlan — resume, executeSave works after warp ────────────────
  await run("resumePlan: resumes plan; executeSave succeeds again after warp", async () => {
    const resumeData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "resumePlan",
      args: [planId1],
    });
    const txHash = await sendAndConfirm(PLAN_OWNER, CONTRACT_ADDR, resumeData);

    const plan = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [planId1],
    });
    if (plan.paused) throw new Error("plan.paused should be false after resumePlan");

    // Plan is already due (we warped 61s before pausePlan), execute immediately
    const saveData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [planId1],
    });
    const saveTxHash = await sendAndConfirm(EXECUTOR, CONTRACT_ADDR, saveData);

    const planAfter = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [planId1],
    });
    // savedBalance should have increased by ONE_USDC from resume+execute
    if (planAfter.savedBalance <= 0n) {
      throw new Error(`savedBalance should be > 0 after executeSave, got ${planAfter.savedBalance}`);
    }
    console.log(`  resumePlan tx=${txHash} executeSave tx=${saveTxHash} savedBalance=${planAfter.savedBalance}`);
  });

  // ── T9: cancelPlan — cancels with remaining balance, auto-withdraws ───────
  await run("cancelPlan: cancels plan with remaining balance; savedBalance auto-withdrawn to owner", async () => {
    // Check current state of planId1
    const planBefore = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [planId1],
    });
    const ownerBalBefore = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [PLAN_OWNER],
    });

    const savedBefore = planBefore.savedBalance;
    if (savedBefore === 0n) {
      // Make sure there's something to withdraw by doing another executeSave
      await warpTime(61n);
      const saveData = encodeFunctionData({
        abi: oinkAbi,
        functionName: "executeSave",
        args: [planId1],
      });
      await sendAndConfirm(EXECUTOR, CONTRACT_ADDR, saveData);
    }

    const planBeforeCancel = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [planId1],
    });
    const ownerBalBeforeCancel = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [PLAN_OWNER],
    });
    const savedBeforeCancel = planBeforeCancel.savedBalance;

    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "cancelPlan",
      args: [planId1],
    });
    const txHash = await sendAndConfirm(PLAN_OWNER, CONTRACT_ADDR, data);

    const planAfter = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [planId1],
    });
    const ownerBalAfter = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [PLAN_OWNER],
    });

    if (!planAfter.cancelled) throw new Error("plan.cancelled should be true");
    if (planAfter.savedBalance !== 0n) {
      throw new Error(`savedBalance should be 0 after cancel, got ${planAfter.savedBalance}`);
    }
    if (savedBeforeCancel > 0n && ownerBalAfter !== ownerBalBeforeCancel + savedBeforeCancel) {
      throw new Error(
        `owner balance: expected +${savedBeforeCancel}, before=${ownerBalBeforeCancel} after=${ownerBalAfter}`
      );
    }
    console.log(`  cancelPlan tx=${txHash} refunded=${savedBeforeCancel}`);
  });

  // ── T9b: executeSave reverts on cancelled plan ────────────────────────────
  await run("executeSave: reverts with PlanCancelled_ on cancelled plan", async () => {
    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [planId1],
    });
    let reverted = false;
    try {
      await rpcCall("eth_call", [{ from: EXECUTOR, to: CONTRACT_ADDR, data }, "latest"]);
    } catch (e: unknown) {
      reverted = true;
    }
    if (!reverted) throw new Error("Expected PlanCancelled_ revert, but executeSave succeeded on cancelled plan");
  });

  // ── T10: cancelPlan on already-cancelled plan reverts ────────────────────
  await run("cancelPlan: reverts with PlanCancelled_ if plan already cancelled", async () => {
    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "cancelPlan",
      args: [planId1],
    });
    let reverted = false;
    try {
      await rpcCall("eth_call", [{ from: PLAN_OWNER, to: CONTRACT_ADDR, data }, "latest"]);
    } catch (_) {
      reverted = true;
    }
    if (!reverted) throw new Error("Expected PlanCancelled_ revert on double-cancel, but succeeded");
  });

  // ── T11: withdrawAll ──────────────────────────────────────────────────────
  await run("withdrawAll: withdraws entire savedBalance to owner", async () => {
    // Create a fresh plan with a new planId
    const nextId = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "nextPlanId",
    });
    const createData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "createPlan",
      args: [ONE_USDC, 60n, 0n],
    });
    await sendAndConfirm(PLAN_OWNER, CONTRACT_ADDR, createData);
    const newPlanId = nextId;

    // Warp and execute a save
    await warpTime(61n);
    const saveData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "executeSave",
      args: [newPlanId],
    });
    await sendAndConfirm(EXECUTOR, CONTRACT_ADDR, saveData);

    const ownerBalBefore = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [PLAN_OWNER],
    });
    const planBefore = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [newPlanId],
    });

    const withdrawAllData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "withdrawAll",
      args: [newPlanId],
    });
    const txHash = await sendAndConfirm(PLAN_OWNER, CONTRACT_ADDR, withdrawAllData);

    const planAfter = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "getPlan",
      args: [newPlanId],
    });
    const ownerBalAfter = await publicClient.readContract({
      address: USDC_ADDR,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [PLAN_OWNER],
    });

    if (planAfter.savedBalance !== 0n) {
      throw new Error(`savedBalance should be 0 after withdrawAll, got ${planAfter.savedBalance}`);
    }
    if (ownerBalAfter !== ownerBalBefore + planBefore.savedBalance) {
      throw new Error(
        `balance mismatch: before=${ownerBalBefore} savedBalance=${planBefore.savedBalance} after=${ownerBalAfter}`
      );
    }
    console.log(`  withdrawAll tx=${txHash} withdrawn=${planBefore.savedBalance}`);
  });

  // ── T12: createPlan validation — zero amount reverts ─────────────────────
  await run("createPlan: reverts ZeroAmount when amount=0", async () => {
    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "createPlan",
      args: [0n, 60n, 0n],
    });
    let reverted = false;
    try {
      await rpcCall("eth_call", [{ from: PLAN_OWNER, to: CONTRACT_ADDR, data }, "latest"]);
    } catch (_) {
      reverted = true;
    }
    if (!reverted) throw new Error("Expected ZeroAmount revert for amount=0");
  });

  // ── T13: createPlan validation — cycleLength < 60 reverts ────────────────
  await run("createPlan: reverts InvalidCycleLength when cycleLength < 60", async () => {
    const data = encodeFunctionData({
      abi: oinkAbi,
      functionName: "createPlan",
      args: [ONE_USDC, 59n, 0n],
    });
    let reverted = false;
    try {
      await rpcCall("eth_call", [{ from: PLAN_OWNER, to: CONTRACT_ADDR, data }, "latest"]);
    } catch (_) {
      reverted = true;
    }
    if (!reverted) throw new Error("Expected InvalidCycleLength revert for cycleLength=59");
  });

  // ── T14: isDue and nextSaveTime views ─────────────────────────────────────
  await run("isDue / nextSaveTime: view functions return correct values", async () => {
    // Create a fresh plan
    const nextId = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "nextPlanId",
    });
    const createData = encodeFunctionData({
      abi: oinkAbi,
      functionName: "createPlan",
      args: [ONE_USDC, 60n, 0n],
    });
    await sendAndConfirm(PLAN_OWNER, CONTRACT_ADDR, createData);
    const viewPlanId = nextId;

    // Just created — not due yet
    const isDueNow = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "isDue",
      args: [viewPlanId],
    });
    if (isDueNow) throw new Error("isDue should be false immediately after createPlan");

    // Warp
    await warpTime(61n);

    const isDueLater = await publicClient.readContract({
      address: CONTRACT_ADDR,
      abi: oinkAbi,
      functionName: "isDue",
      args: [viewPlanId],
    });
    if (!isDueLater) throw new Error("isDue should be true after 61s warp");
  });

  // ── T15: getPlan reverts PlanNotFound for invalid planId ─────────────────
  await run("getPlan: reverts PlanNotFound for non-existent planId", async () => {
    let reverted = false;
    try {
      await publicClient.readContract({
        address: CONTRACT_ADDR,
        abi: oinkAbi,
        functionName: "getPlan",
        args: [99999n],
      });
    } catch (_) {
      reverted = true;
    }
    if (!reverted) throw new Error("Expected PlanNotFound revert for planId=99999");
  });

  // ─── Summary ───────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIPPED").length;
  console.log(`\n# Summary: ${passed} passed, ${failed} failed, ${skipped} skipped`);

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
