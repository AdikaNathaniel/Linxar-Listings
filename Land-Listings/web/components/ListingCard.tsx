import { formatEther, type Address } from "viem";
import { HouseIcon, PinIcon } from "./icons";

export type Listing = {
  id: bigint;
  owner: Address;
  title: string;
  location: string;
  priceWei: bigint;
  active: boolean;
};

// Listings have no photos yet (they arrive in Milestone 4, via IPFS),
// so each card gets a coloured placeholder that varies with its id.
const PLACEHOLDERS = [
  "from-emerald-700 to-teal-500",
  "from-amber-600 to-yellow-400",
  "from-teal-800 to-cyan-600",
  "from-orange-700 to-amber-500",
  "from-green-800 to-lime-600",
];

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type Props = {
  listing: Listing;
  isMine: boolean;
  busy: boolean;
  onDeactivate: (id: bigint) => void;
};

export function ListingCard({ listing, isMine, busy, onDeactivate }: Props) {
  const placeholder = PLACEHOLDERS[Number(listing.id % BigInt(PLACEHOLDERS.length))];

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        listing.active ? "" : "opacity-60 grayscale"
      }`}
    >
      {/* Image area */}
      <div className={`relative flex h-36 items-center justify-center bg-gradient-to-br ${placeholder}`}>
        <HouseIcon className="h-12 w-12 text-white/80" />
        <span className="absolute left-3 top-3 rounded-full bg-black/35 px-2.5 py-1 font-mono text-xs text-white backdrop-blur">
          #{listing.id.toString()}
        </span>
        <span
          className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-medium ${
            listing.active ? "bg-success-soft text-success" : "bg-surface-2 text-muted"
          }`}
        >
          {listing.active ? "Available" : "Inactive"}
        </span>
      </div>

      {/* Details */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="line-clamp-1 text-base font-semibold">{listing.title}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <PinIcon className="h-4 w-4 shrink-0" />
            <span className="line-clamp-1">{listing.location}</span>
          </p>
        </div>

        {/* formatEther: wei → ETH, e.g. 2500000000000000000n → "2.5" */}
        <p className="text-xl font-bold text-accent">
          {formatEther(listing.priceWei)} <span className="text-sm font-semibold">ETH</span>
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
          <span className="flex items-center gap-2 text-xs text-muted">
            <span className="font-mono">{shortAddress(listing.owner)}</span>
            {isMine && (
              <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand">You</span>
            )}
          </span>

          {/* Only the owner sees this button. The CONTRACT enforces the rule
              regardless: the button is just a convenience */}
          {listing.active && isMine && (
            <button
              onClick={() => onDeactivate(listing.id)}
              disabled={busy}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
            >
              Deactivate
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="h-36 animate-pulse bg-surface-2" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
        <div className="h-6 w-1/3 animate-pulse rounded bg-surface-2" />
      </div>
    </div>
  );
}
