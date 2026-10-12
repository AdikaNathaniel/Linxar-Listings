"use client";

import { formatEther, type Address } from "viem";
import { DEAL_KINDS, DEAL_STATUSES, DealKind, DealStatus, type Deal, type DealAction } from "../lib/escrow";
import { shortAddress, type Listing } from "./ListingCard";
import { useMetadata } from "./useMetadata";

const STATUS_STYLES = [
  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300", // Waiting for seller
  "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300", // Accepted
  "bg-success-soft text-success", // Completed
  "bg-surface-2 text-muted", // Refunded
  "bg-danger-soft text-danger", // Disputed
];

type Props = {
  deals: Deal[];
  listings: Listing[];
  account: Address;
  isArbiter: boolean;
  confirmWindowSeconds: bigint;
  chainTime: bigint; // the latest block's timestamp: the clock the contract uses
  pendingWithdrawal: bigint; // ETH the escrow owes this wallet
  busy: boolean;
  onAction: (deal: Deal, action: DealAction) => void;
  onWithdraw: () => void;
  onMessage?: (address: Address) => void; // Milestone 10: chat with the other party
};

// "My deals": every deal where this wallet is the buyer or seller (plus, for
// the arbiter, every disputed deal), with the buttons the rules allow.
export function DealsPanel({
  deals,
  listings,
  account,
  isArbiter,
  confirmWindowSeconds,
  chainTime,
  pendingWithdrawal,
  busy,
  onAction,
  onWithdraw,
  onMessage,
}: Props) {
  if (deals.length === 0 && pendingWithdrawal === 0n) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">My deals</h2>
        <p className="text-sm text-muted">
          Money locked in the escrow contract. It only moves when the rules below allow it.
        </p>
      </div>

      {/* PULL PAYMENTS: money the escrow owes you waits here until you withdraw it */}
      {pendingWithdrawal > 0n && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-success/30 bg-success-soft px-4 py-3 text-success">
          <p className="text-sm font-medium">
            The escrow owes you <strong>{formatEther(pendingWithdrawal)} ETH</strong>. It stays in the contract until
            you withdraw it.
          </p>
          <button
            onClick={onWithdraw}
            disabled={busy}
            className="rounded-xl bg-success px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Withdraw
          </button>
        </div>
      )}

      <div className="space-y-2">
        {deals.map((deal) => (
          <DealRow
            key={deal.id.toString()}
            deal={deal}
            listing={listings.find((l) => l.id === deal.listingId)}
            account={account}
            isArbiter={isArbiter}
            confirmWindowSeconds={confirmWindowSeconds}
            chainTime={chainTime}
            busy={busy}
            onAction={onAction}
            onMessage={onMessage}
          />
        ))}
      </div>
    </section>
  );
}

function DealRow({
  deal,
  listing,
  account,
  isArbiter,
  confirmWindowSeconds,
  chainTime,
  busy,
  onAction,
  onMessage,
}: {
  deal: Deal;
  listing: Listing | undefined;
  account: Address;
  isArbiter: boolean;
  confirmWindowSeconds: bigint;
  chainTime: bigint;
  busy: boolean;
  onAction: (deal: Deal, action: DealAction) => void;
  onMessage?: (address: Address) => void;
}) {
  const metadata = useMetadata(listing?.metadataCID);
  const me = account.toLowerCase();
  const isBuyer = deal.buyer.toLowerCase() === me;
  const isSeller = deal.seller.toLowerCase() === me;
  const role = isBuyer ? "You're buying" : isSeller ? "You're selling" : "Arbiter";

  // The 7-day window: after acceptance, the buyer has until `windowEnds`
  // to confirm or dispute. After that, the seller may finalise.
  const windowEnds = deal.acceptedAt + confirmWindowSeconds;
  const windowEndsDate = new Date(Number(windowEnds) * 1000);
  const windowOver = chainTime > windowEnds; // same comparison as the contract

  // Only show the buttons the CONTRACT would allow for this person, in this
  // state. (The contract enforces it anyway: these are just the right controls.)
  const buttons: { action: DealAction; label: string; danger?: boolean }[] = [];
  if (deal.status === DealStatus.Funded) {
    if (isBuyer) buttons.push({ action: "cancel", label: "Cancel & get refund", danger: true });
    if (isSeller) {
      buttons.push({ action: "accept", label: "Accept offer" });
      buttons.push({ action: "reject", label: "Reject", danger: true });
    }
  } else if (deal.status === DealStatus.Accepted) {
    if (isBuyer) buttons.push({ action: "confirm", label: "Confirm: all good" });
    if (isSeller && windowOver) buttons.push({ action: "finalize", label: "Finalise (buyer silent)" });
    if (isBuyer || isSeller) buttons.push({ action: "dispute", label: "Raise dispute", danger: true });
  } else if (deal.status === DealStatus.Disputed && isArbiter) {
    buttons.push({ action: "refund", label: "Refund buyer" });
    buttons.push({ action: "release", label: "Pay seller" });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Deal #{deal.id.toString()} · {DEAL_KINDS[deal.kind]} · {role}
          </p>
          <p className="mt-0.5 truncate font-semibold">
            {metadata?.title ?? `Listing #${deal.listingId}`}
          </p>
          <p className="text-sm text-muted">
            <span className="font-semibold text-accent">{formatEther(deal.amount)} ETH</span> locked ·{" "}
            {isBuyer ? `seller ${shortAddress(deal.seller)}` : `buyer ${shortAddress(deal.buyer)}`}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[deal.status]}`}>
          {DEAL_STATUSES[deal.status]}
        </span>
      </div>

      {/* What happens next, in plain words */}
      <p className="mt-2 text-xs text-muted">
        {deal.status === DealStatus.Funded &&
          (isSeller
            ? deal.kind === DealKind.Purchase
              ? "Accepting asks MetaMask twice: first to let the escrow transfer your property NFT, then to accept."
              : "Accept to commit to this tenant, or reject to refund them."
            : "Waiting for the seller. You can cancel any time before they accept.")}
        {deal.status === DealStatus.Accepted &&
          (isBuyer
            ? `Visit and check the property, then confirm to release the payment${
                deal.kind === DealKind.Purchase ? " and receive the property NFT" : ""
              }. Confirm or dispute by ${windowEndsDate.toLocaleString()}.`
            : windowOver
              ? "The buyer's window has passed. You can finalise the deal."
              : `Waiting for the buyer to confirm (until ${windowEndsDate.toLocaleString()}).`)}
        {deal.status === DealStatus.Disputed &&
          (isArbiter ? "You're the arbiter: decide who receives the money." : "Waiting for the arbiter's decision.")}
        {deal.status === DealStatus.Completed &&
          (deal.kind === DealKind.Purchase
            ? "Done: the seller was paid and the property NFT moved to the buyer, in one transaction."
            : "Done: the deposit was released to the landlord.")}
        {deal.status === DealStatus.Refunded && "Refunded: the money went back to the buyer."}
      </p>

      {/* Chat with the other side of the deal (Milestone 10) */}
      {onMessage && (isBuyer || isSeller) && (
        <button
          onClick={() => onMessage(isBuyer ? deal.seller : deal.buyer)}
          className="mt-2 text-xs font-semibold text-brand hover:underline"
        >
          💬 Message {isBuyer ? "seller" : "buyer"}
        </button>
      )}

      {buttons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {buttons.map((button) => (
            <button
              key={button.action}
              onClick={() => onAction(deal, button.action)}
              disabled={busy}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                button.danger
                  ? "border border-line hover:border-danger hover:text-danger"
                  : "bg-brand text-on-brand hover:bg-brand-strong"
              }`}
            >
              {button.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
