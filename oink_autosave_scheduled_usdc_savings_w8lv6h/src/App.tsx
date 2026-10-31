/**
 * Oink Autosave — scheduled USDC savings on Arc Mainnet
 * Built with Arc Studio — https://studio.arc.io
 */
import { useState, useCallback } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi } from 'viem'
import { Plus, Play, Pause, X, ArrowDownToLine, RefreshCw, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { OINK_AUTOSAVE, USDC_ADDRESS, ARC_TESTNET_CHAIN_ID } from './contract'
import { Amount, parseUsdc, formatUsdc, usdcDecimalsFor } from './onchain-money'
import { buildTxExplorerUrl } from './onchain-facts'

// ─── design tokens ────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'var(--card-bg)',
  backdropFilter: 'blur(20px) saturate(160%)',
  WebkitBackdropFilter: 'blur(20px) saturate(160%)',
  border: '1px solid var(--card-border)',
  boxShadow: '0 4px 24px rgba(30,107,66,0.08), 0 1px 0 rgba(168,224,99,0.15) inset',
}

const inner: React.CSSProperties = {
  background: 'var(--inner-bg)',
  border: '1px solid var(--inner-border)',
}

// Oink accent stripe — single-color brand instead of rainbow
const accentStripe = 'linear-gradient(90deg, #A8E063 0%, #1E6B42 100%)'

// Inline pig SVG mascot — replaces PiggyBank icon where mascot is shown
const OinkMascot = ({ size = 48, className = '' }: { size?: number; className?: string }) => (
  <svg
    width={size} height={size} viewBox="0 0 100 100"
    className={className}
    aria-label="Oink pig mascot"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* body */}
    <ellipse cx="50" cy="56" rx="36" ry="32" fill="#A8E063" />
    {/* glow */}
    <ellipse cx="50" cy="44" rx="22" ry="18" fill="rgba(255,255,255,0.35)" />
    {/* left ear */}
    <ellipse cx="22" cy="30" rx="10" ry="13" fill="#A8E063" transform="rotate(-15 22 30)" />
    <ellipse cx="22" cy="30" rx="6" ry="8" fill="#7EC84A" transform="rotate(-15 22 30)" />
    {/* right ear */}
    <ellipse cx="78" cy="30" rx="10" ry="13" fill="#A8E063" transform="rotate(15 78 30)" />
    <ellipse cx="78" cy="30" rx="6" ry="8" fill="#7EC84A" transform="rotate(15 78 30)" />
    {/* eyes */}
    <ellipse cx="37" cy="52" rx="5" ry="6" fill="white" />
    <circle cx="38" cy="53" r="3" fill="#1E6B42" />
    <circle cx="39" cy="52" r="1" fill="white" />
    <ellipse cx="63" cy="52" rx="5" ry="6" fill="white" />
    <circle cx="64" cy="53" r="3" fill="#1E6B42" />
    <circle cx="65" cy="52" r="1" fill="white" />
    {/* snout */}
    <ellipse cx="50" cy="68" rx="12" ry="9" fill="#7EC84A" />
    <circle cx="46" cy="68" r="2.5" fill="#1E6B42" />
    <circle cx="54" cy="68" r="2.5" fill="#1E6B42" />
    {/* highlight */}
    <ellipse cx="40" cy="38" rx="8" ry="6" fill="rgba(255,255,255,0.45)" />
  </svg>
)

// ─── types ────────────────────────────────────────────────────────────────────
type Plan = {
  amount: bigint
  cycleLength: bigint
  goal: bigint
  savedBalance: bigint
  lastSaveTimestamp: bigint
  paused: boolean
  cancelled: boolean
  owner: string
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function fmtUsdc(raw: bigint): string {
  return Amount.fromRaw(raw, usdcDecimalsFor(ARC_TESTNET_CHAIN_ID)).toFixed(2)
}

function fmtCycle(seconds: bigint): string {
  const s = Number(seconds)
  if (s < 120) return `${s}s`
  if (s < 7200) return `${Math.round(s / 60)}m`
  if (s < 172800) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

function fmtDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function fmtGoalPct(saved: bigint, goal: bigint): number | null {
  if (goal === 0n) return null
  return Math.min(100, Number((saved * 100n) / goal))
}

// ─── hook: list of plan IDs owned by the connected wallet ────────────────────
function useMyPlanIds(address?: string) {
  return useReadContract({
    address: OINK_AUTOSAVE.address,
    abi: OINK_AUTOSAVE.abi,
    functionName: 'getUserPlans',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: 8000 },
    chainId: ARC_TESTNET_CHAIN_ID,
  })
}

function usePlan(planId: bigint, enabled: boolean) {
  return useReadContract({
    address: OINK_AUTOSAVE.address,
    abi: OINK_AUTOSAVE.abi,
    functionName: 'getPlan',
    args: [planId],
    query: { enabled, refetchInterval: 8000 },
    chainId: ARC_TESTNET_CHAIN_ID,
  })
}

function useIsDue(planId: bigint, enabled: boolean) {
  return useReadContract({
    address: OINK_AUTOSAVE.address,
    abi: OINK_AUTOSAVE.abi,
    functionName: 'isDue',
    args: [planId],
    query: { enabled, refetchInterval: 5000 },
    chainId: ARC_TESTNET_CHAIN_ID,
  })
}

function useUsdcBalance(address?: string) {
  return useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: 10000 },
    chainId: ARC_TESTNET_CHAIN_ID,
  })
}

function useUsdcAllowance(owner?: string) {
  return useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: owner ? [owner as `0x${string}`, OINK_AUTOSAVE.address] : undefined,
    query: { enabled: !!owner, refetchInterval: 8000 },
    chainId: ARC_TESTNET_CHAIN_ID,
  })
}

// ─── TxButton ─────────────────────────────────────────────────────────────────
type TxState = { hash?: `0x${string}`; isPending: boolean; isConfirming: boolean; isSuccess: boolean }

function TxButton({
  label, disabled, onClick, txState, accent = false,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  txState: TxState
  accent?: boolean
}) {
  const busy = txState.isPending || txState.isConfirming
  return (
    <button
      disabled={disabled || busy}
      onClick={onClick}
      className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        background: accent ? 'var(--accent)' : 'var(--inner-bg)',
        color: accent ? (busy ? 'rgba(255,255,255,0.8)' : '#FFFFFF') : 'var(--ink)',
        border: accent ? 'none' : '1px solid var(--inner-border)',
        boxShadow: accent ? '0 2px 12px rgba(30,107,66,0.25)' : undefined,
      }}
    >
      {txState.isPending ? (
        <span className="flex items-center justify-center gap-2">
          <RefreshCw className="size-4 animate-spin" /> Confirm in wallet…
        </span>
      ) : txState.isConfirming ? (
        <span className="flex items-center justify-center gap-2">
          <RefreshCw className="size-4 animate-spin" /> Confirming…
        </span>
      ) : label}
    </button>
  )
}

// ─── PlanCard ─────────────────────────────────────────────────────────────────
function PlanCard({ planId, onRefresh }: { planId: bigint; onRefresh: () => void }) {
  const { data: planRaw, refetch: refetchPlan } = usePlan(planId, true)
  const plan = planRaw as Plan | undefined
  const { data: isDueRaw, refetch: refetchDue } = useIsDue(planId, true)
  const isDue = isDueRaw as boolean | undefined
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [showWithdraw, setShowWithdraw] = useState(false)

  const { writeContract, data: hash, isPending, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const refresh = useCallback(async () => {
    await Promise.all([refetchPlan(), refetchDue()])
    onRefresh()
  }, [refetchPlan, refetchDue, onRefresh])

  // after any tx success, refresh and notify
  const [lastHash, setLastHash] = useState<string>()
  if (isSuccess && hash && hash !== lastHash) {
    setLastHash(hash)
    void refresh()
    reset()
  }

  if (!plan) return (
    <div className="rounded-2xl p-5 animate-pulse" style={card}>
      <div className="h-4 rounded-lg w-1/3 mb-2" style={{ background: 'var(--inner-bg)' }} />
      <div className="h-8 rounded-lg w-1/2" style={{ background: 'var(--inner-bg)' }} />
    </div>
  )

  const p = plan
  if (p.cancelled) return null

  const goalPct = fmtGoalPct(p.savedBalance, p.goal)
  const nextSave = Number(p.lastSaveTimestamp + p.cycleLength)
  const txState: TxState = { hash, isPending, isConfirming, isSuccess }

  const handleSave = () => {
    writeContract({
      address: OINK_AUTOSAVE.address,
      abi: OINK_AUTOSAVE.abi,
      functionName: 'executeSave',
      args: [planId],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  const handlePause = () => {
    writeContract({
      address: OINK_AUTOSAVE.address,
      abi: OINK_AUTOSAVE.abi,
      functionName: p.paused ? 'resumePlan' : 'pausePlan',
      args: [planId],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  const handleCancel = () => {
    if (!confirm('Cancel this plan? Any saved USDC will be returned to your wallet.')) return
    writeContract({
      address: OINK_AUTOSAVE.address,
      abi: OINK_AUTOSAVE.abi,
      functionName: 'cancelPlan',
      args: [planId],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  const handleWithdraw = () => {
    if (!withdrawAmt) return
    let raw: bigint
    try {
      raw = parseUsdc(withdrawAmt)
    } catch {
      toast.error('Invalid amount')
      return
    }
    writeContract({
      address: OINK_AUTOSAVE.address,
      abi: OINK_AUTOSAVE.abi,
      functionName: 'withdraw',
      args: [planId, raw],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
    setShowWithdraw(false)
    setWithdrawAmt('')
  }

  const handleWithdrawAll = () => {
    writeContract({
      address: OINK_AUTOSAVE.address,
      abi: OINK_AUTOSAVE.abi,
      functionName: 'withdrawAll',
      args: [planId],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={card}>
      {/* Oink accent stripe */}
      <div className="h-1" style={{ background: accentStripe }} />

      <div className="p-5">
        {/* header row: big saved balance + controls */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="text-xs font-semibold tracking-widest uppercase mb-1" style={{ color: 'var(--muted)' }}>
              Plan #{planId.toString()}
            </div>
            <div className="text-3xl font-bold tabular-nums leading-tight" style={{ color: 'var(--accent)', letterSpacing: '-0.02em' }}>
              {fmtUsdc(p.savedBalance)}
              <span className="text-base font-medium ml-1.5" style={{ color: 'var(--muted)' }}>USDC saved</span>
            </div>
          </div>
          <div className="flex gap-1.5 mt-0.5">
            <button
              onClick={handlePause}
              title={p.paused ? 'Resume' : 'Pause'}
              className="size-9 flex items-center justify-center rounded-xl transition hover:opacity-75"
              style={inner}
            >
              {p.paused
                ? <Play className="size-4" style={{ color: 'var(--success)' }} />
                : <Pause className="size-4" style={{ color: 'var(--muted)' }} />}
            </button>
            <button
              onClick={handleCancel}
              title="Cancel plan"
              className="size-9 flex items-center justify-center rounded-xl transition hover:opacity-75"
              style={inner}
            >
              <X className="size-4" style={{ color: 'var(--danger)' }} />
            </button>
          </div>
        </div>

        {/* stats chips */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="rounded-xl p-3" style={inner}>
            <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--muted)' }}>Per cycle</div>
            <div className="text-sm font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
              {fmtUsdc(p.amount)} USDC
            </div>
          </div>
          <div className="rounded-xl p-3" style={inner}>
            <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--muted)' }}>Frequency</div>
            <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Every {fmtCycle(p.cycleLength)}
            </div>
          </div>
        </div>

        {/* goal progress */}
        {goalPct !== null && (
          <div className="mb-4">
            <div className="flex justify-between text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>
              <span>Goal</span>
              <span style={{ color: 'var(--accent)' }}>{goalPct}% of {fmtUsdc(p.goal)} USDC</span>
            </div>
            <div className="h-2 rounded-full" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${goalPct}%`, background: 'var(--accent-light)' }}
              />
            </div>
          </div>
        )}

        {/* next save status */}
        <div
          className="text-xs font-medium rounded-xl px-3 py-2 mb-4 inline-flex items-center gap-1.5"
          style={{
            background: p.paused ? 'rgba(180,83,9,0.08)' : isDue ? 'rgba(168,224,99,0.18)' : 'var(--inner-bg)',
            color: p.paused ? 'var(--warn)' : isDue ? 'var(--accent)' : 'var(--muted)',
            border: '1px solid var(--inner-border)',
          }}
        >
          {p.paused ? '⏸ Plan paused'
            : isDue ? '● Save is due now'
            : `⏱ Next save: ${fmtDate(BigInt(nextSave))}`}
        </div>

        {/* save now — prominent dark-green button */}
        {isDue && !p.paused && (
          <div className="mb-3">
            <TxButton label="Save now" accent txState={txState} onClick={handleSave} />
            {isSuccess && hash && (
              <a
                href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, hash)}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-xs mt-2 justify-center font-medium"
                style={{ color: 'var(--success)' }}
              >
                Confirmed <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}

        {/* withdraw */}
        {p.savedBalance > 0n && (
          <div className="space-y-2">
            {showWithdraw ? (
              <div className="rounded-xl p-3 space-y-2" style={inner}>
                <input
                  inputMode="decimal"
                  placeholder="Amount to withdraw"
                  value={withdrawAmt}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, '')
                    if (v === '' || /^\d*\.?\d*$/.test(v)) setWithdrawAmt(v)
                  }}
                  className="w-full bg-transparent text-sm outline-none font-medium"
                  style={{ color: 'var(--ink)' }}
                />
                <div className="flex gap-2">
                  <TxButton label="Withdraw" txState={txState} onClick={handleWithdraw} />
                  <button
                    onClick={() => setShowWithdraw(false)}
                    className="px-3 rounded-xl text-sm font-medium"
                    style={{ color: 'var(--muted)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowWithdraw(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition hover:opacity-80"
                  style={{ ...inner, color: 'var(--accent)' }}
                >
                  <ArrowDownToLine className="size-4" /> Withdraw
                </button>
                <div className="flex-1">
                  <TxButton label="Withdraw all" txState={txState} onClick={handleWithdrawAll} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── CreatePlanSheet ──────────────────────────────────────────────────────────
function CreatePlanSheet({
  onClose,
  onCreated,
  usdcBalance,
  allowance,
  onRefreshAllowance,
}: {
  onClose: () => void
  onCreated: () => void
  usdcBalance?: bigint
  allowance?: bigint
  onRefreshAllowance: () => void
}) {
  const [amount, setAmount] = useState('1')
  const [cycleDays, setCycleDays] = useState('7')
  const [goal, setGoal] = useState('')
  const [step, setStep] = useState<'form' | 'approve' | 'create'>('form')

  const { writeContract: approve, data: appHash, isPending: appPending, reset: appReset } = useWriteContract()
  const { isLoading: appConfirming, isSuccess: appSuccess } = useWaitForTransactionReceipt({ hash: appHash })

  const { writeContract: create, data: crtHash, isPending: crtPending, reset: crtReset } = useWriteContract()
  const { isLoading: crtConfirming, isSuccess: crtSuccess } = useWaitForTransactionReceipt({ hash: crtHash })

  const amountRaw = (() => {
    try { return parseUsdc(amount || '0') } catch { return 0n }
  })()
  const cycleSecs = BigInt(Math.max(60, Math.round(parseFloat(cycleDays || '0') * 86400)))
  const goalRaw = (() => {
    try { return goal ? parseUsdc(goal) : 0n } catch { return 0n }
  })()

  const needsApproval = (allowance ?? 0n) < amountRaw

  // auto-advance after approval
  if (appSuccess && step === 'approve') {
    setStep('create')
    appReset()
    onRefreshAllowance()
  }

  // close after create
  if (crtSuccess) {
    onCreated()
    crtReset()
    onClose()
  }

  const handleApprove = () => {
    // approve a large fixed amount (max uint256) so the user only has to do this once
    approve({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [OINK_AUTOSAVE.address, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
    setStep('approve')
  }

  const handleCreate = () => {
    if (amountRaw === 0n) { toast.error('Enter a valid amount'); return }
    if (cycleSecs < 60n) { toast.error('Cycle must be at least 60 seconds'); return }
    if (goalRaw !== 0n && goalRaw < amountRaw) { toast.error('Goal must be ≥ amount per cycle'); return }
    create({
      address: OINK_AUTOSAVE.address,
      abi: OINK_AUTOSAVE.abi,
      functionName: 'createPlan',
      args: [amountRaw, cycleSecs, goalRaw],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
    setStep('create')
  }

  const approveState: TxState = { hash: appHash, isPending: appPending, isConfirming: appConfirming, isSuccess: appSuccess }
  const createState: TxState = { hash: crtHash, isPending: crtPending, isConfirming: crtConfirming, isSuccess: crtSuccess }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md overflow-hidden"
        style={{
          background: 'var(--sheet-bg)',
          borderRadius: '24px 24px 0 0',
          boxShadow: '0 -8px 40px rgba(30,107,66,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1" style={{ background: accentStripe }} />
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1.5 w-12 rounded-full" style={{ background: 'var(--inner-border)' }} />
        </div>
        <div className="px-5 pb-8 pt-3">
          <h2 className="text-xl font-bold mb-5" style={{ color: 'var(--ink)' }}>New Savings Plan</h2>

          {/* amount */}
          <label className="block mb-3">
            <span className="text-xs font-semibold uppercase tracking-widest mb-1.5 block" style={{ color: 'var(--muted)' }}>
              Save per cycle (USDC)
            </span>
            <div className="rounded-2xl p-4" style={inner}>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, '')
                  if (v === '' || /^\d*\.?\d*$/.test(v)) setAmount(v)
                }}
                placeholder="1.00"
                className="w-full bg-transparent text-3xl font-bold tabular-nums outline-none"
                style={{ color: 'var(--accent)', letterSpacing: '-0.02em' }}
              />
              <div className="mt-1 flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>USDC</span>
                {usdcBalance != null && (
                  <button
                    onClick={() => setAmount(formatUsdc(usdcBalance))}
                    className="text-xs font-semibold"
                    style={{ color: 'var(--accent-hover)' }}
                  >
                    Balance: {fmtUsdc(usdcBalance)} · Max
                  </button>
                )}
              </div>
            </div>
          </label>

          {/* quick amount chips */}
          <div className="flex gap-2 mb-4">
            {['0.5', '1', '5', '10'].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(v)}
                className="flex-1 rounded-xl py-2 text-xs font-semibold transition"
                style={{
                  ...inner,
                  color: amount === v ? 'var(--oink-white, #fff)' : 'var(--accent)',
                  background: amount === v ? 'var(--accent)' : undefined,
                  border: amount === v ? 'none' : '1px solid var(--inner-border)',
                }}
              >
                {v}
              </button>
            ))}
          </div>

          {/* cycle */}
          <label className="block mb-4">
            <span className="text-xs font-semibold uppercase tracking-widest mb-1.5 block" style={{ color: 'var(--muted)' }}>
              Save every
            </span>
            <div className="flex gap-2">
              {['1', '3', '7', '14', '30'].map((d) => (
                <button
                  key={d}
                  onClick={() => setCycleDays(d)}
                  className="flex-1 rounded-xl py-2.5 text-xs font-semibold transition"
                  style={{
                    ...inner,
                    color: cycleDays === d ? 'var(--oink-white, #fff)' : 'var(--accent)',
                    background: cycleDays === d ? 'var(--accent)' : undefined,
                    border: cycleDays === d ? 'none' : '1px solid var(--inner-border)',
                  }}
                >
                  {d}d
                </button>
              ))}
            </div>
          </label>

          {/* goal (optional) */}
          <label className="block mb-5">
            <span className="text-xs font-semibold uppercase tracking-widest mb-1.5 block" style={{ color: 'var(--muted)' }}>
              Savings goal (optional)
            </span>
            <div className="rounded-2xl px-4 py-3" style={inner}>
              <input
                inputMode="decimal"
                value={goal}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, '')
                  if (v === '' || /^\d*\.?\d*$/.test(v)) setGoal(v)
                }}
                placeholder="No goal"
                className="w-full bg-transparent text-sm font-medium outline-none"
                style={{ color: 'var(--ink)' }}
              />
            </div>
          </label>

          {/* summary */}
          <div className="rounded-2xl p-4 mb-5 text-sm" style={{ ...inner, background: 'rgba(168,224,99,0.08)' }}>
            <div className="flex justify-between mb-1.5">
              <span className="font-medium" style={{ color: 'var(--muted)' }}>Saving</span>
              <span className="font-bold tabular-nums" style={{ color: 'var(--accent)' }}>{amount || '0'} USDC</span>
            </div>
            <div className="flex justify-between mb-1.5">
              <span className="font-medium" style={{ color: 'var(--muted)' }}>Every</span>
              <span className="font-bold" style={{ color: 'var(--ink)' }}>{cycleDays} day{cycleDays !== '1' ? 's' : ''}</span>
            </div>
            {goal && (
              <div className="flex justify-between">
                <span className="font-medium" style={{ color: 'var(--muted)' }}>Goal</span>
                <span className="font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{goal} USDC</span>
              </div>
            )}
          </div>

          {/* CTA */}
          {needsApproval ? (
            <TxButton label="Approve USDC" accent txState={approveState} onClick={handleApprove} />
          ) : (
            <TxButton label="Start Saving 🐷" accent txState={createState} onClick={handleCreate} />
          )}
          <p className="text-xs text-center mt-3" style={{ color: 'var(--muted)' }}>
            {needsApproval
              ? 'Approve once — the contract pulls USDC on schedule automatically.'
              : 'Pause or cancel any time. Withdraw whenever you like.'}
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = isConnected && chainId !== ARC_TESTNET_CHAIN_ID

  const { data: planIds, refetch: refetchPlans } = useMyPlanIds(address)
  const { data: usdcBalance, refetch: refetchBalance } = useUsdcBalance(address)
  const { data: allowance, refetch: refetchAllowance } = useUsdcAllowance(address)

  const [showCreate, setShowCreate] = useState(false)

  const handleRefreshAll = useCallback(() => {
    void refetchPlans()
    void refetchBalance()
    void refetchAllowance()
  }, [refetchPlans, refetchBalance, refetchAllowance])

  const ids = (planIds as bigint[] | undefined) ?? []

  return (
    <div
      className="relative min-h-dvh overflow-hidden"
      style={{ background: 'var(--surface-bg)' }}
    >
      {/* subtle green glow blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div style={{ position: 'absolute', top: '6%', left: '-5%', width: 340, height: 340, borderRadius: '50%', background: 'radial-gradient(circle, rgba(168,224,99,0.18) 0%, transparent 65%)', filter: 'blur(70px)' }} />
        <div style={{ position: 'absolute', bottom: '10%', right: '-4%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(30,107,66,0.12) 0%, transparent 65%)', filter: 'blur(60px)' }} />
      </div>

      <div className="relative z-10 mx-auto max-w-md px-4 pb-12 pt-6">

        {/* ── header ─────────────────────────────────────────────────────── */}
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* pig logo */}
            <div
              className="size-10 rounded-2xl overflow-hidden flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(168,224,99,0.18)', border: '1px solid rgba(168,224,99,0.35)' }}
            >
              <OinkMascot size={36} />
            </div>
            <div>
              <div className="text-base font-bold leading-tight" style={{ color: 'var(--oink-dark, #1E6B42)', letterSpacing: '-0.01em' }}>
                Oink
              </div>
              <div className="text-xs font-medium leading-tight" style={{ color: 'var(--muted)' }}>
                Autosave
              </div>
            </div>
          </div>
          <ConnectKitButton />
        </header>

        {/* ── wrong chain banner ─────────────────────────────────────────── */}
        {wrongChain && (
          <div
            className="rounded-2xl p-4 mb-4 text-sm font-semibold flex items-center justify-between"
            style={{ background: 'rgba(180,83,9,0.08)', color: 'var(--warn)', border: '1px solid rgba(180,83,9,0.18)' }}
          >
            <span>Switch to Arc Mainnet</span>
            <button
              onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-white"
              style={{ background: 'var(--warn)' }}
            >
              Switch
            </button>
          </div>
        )}

        {/* ── connected view ─────────────────────────────────────────────── */}
        {isConnected && !wrongChain && (
          <>
            {/* hero wallet balance card */}
            <section className="rounded-2xl p-5 mb-4" style={card}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                  Wallet Balance
                </span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(168,224,99,0.20)', color: 'var(--accent)' }}>
                  Arc Mainnet
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-4xl font-bold tabular-nums" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
                  {usdcBalance != null ? fmtUsdc(usdcBalance) : '—'}
                </span>
                <span className="text-lg font-medium" style={{ color: 'var(--muted)' }}>USDC</span>
              </div>
            </section>

            {/* plan list or empty state */}
            {ids.length > 0 ? (
              <div className="space-y-3 mb-4">
                {ids.map((id) => (
                  <PlanCard key={id.toString()} planId={id} onRefresh={handleRefreshAll} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl p-8 mb-4 text-center" style={card}>
                <OinkMascot size={72} className="mx-auto mb-4 opacity-80" />
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>No savings plans yet</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Create your first plan and let Oink save for you automatically.
                </p>
              </div>
            )}

            {/* new plan CTA */}
            <button
              onClick={() => setShowCreate(true)}
              className="w-full rounded-2xl py-4 flex items-center justify-center gap-2 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'var(--accent)', boxShadow: '0 4px 16px rgba(30,107,66,0.30)' }}
            >
              <Plus className="size-4" /> New Savings Plan
            </button>
          </>
        )}

        {/* ── not connected ──────────────────────────────────────────────── */}
        {!isConnected && (
          <div className="rounded-2xl p-8 text-center mt-8" style={card}>
            <OinkMascot size={88} className="mx-auto mb-5" />
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--accent)', letterSpacing: '-0.01em' }}>
              Automate your USDC savings
            </h2>
            <p className="text-sm mb-6 leading-relaxed" style={{ color: 'var(--muted)' }}>
              Set a recurring plan. Approve once.<br />Let Oink save on schedule.
            </p>
            <ConnectKitButton label="Connect Wallet to Start" />
          </div>
        )}

      </div>

      {/* ── create plan sheet ───────────────────────────────────────────── */}
      {showCreate && (
        <CreatePlanSheet
          onClose={() => setShowCreate(false)}
          onCreated={handleRefreshAll}
          usdcBalance={usdcBalance ?? undefined}
          allowance={allowance ?? undefined}
          onRefreshAllowance={() => { void refetchAllowance() }}
        />
      )}
    </div>
  )
}
