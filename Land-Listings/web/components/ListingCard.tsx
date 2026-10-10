"use client";

import { useEffect, useState } from "react";
import { formatEther, type Address } from "viem";
import { fetchMetadata, gatewayUrl, type ListingMetadata } from "../lib/ipfs";
import { CATEGORIES, LISTING_TYPES, PRICE_PERIODS, STATUSES, Status } from "../lib/listingOptions";
import { CloseIcon, HouseIcon, PinIcon } from "./icons";

// The shape of one listing as the contract returns it (see the Listing struct).
// uint256/uint64 → bigint; enums and uint32 → number.
export type Listing = {
  id: bigint;
  owner: Address;
  listingType: number;
  category: number;
  status: number;
  pricePeriod: number;
  sizeSqm: number;
  priceWei: bigint;
  createdAt: bigint;
  updatedAt: bigint;
  region: string;
  metadataCID: string;
};

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Listings whose metadata can't be loaded (e.g. made with a fake CID in the
// tests) still get a coloured placeholder.
const PLACEHOLDERS = [
  "from-emerald-700 to-teal-500",
  "from-amber-600 to-yellow-400",
  "from-teal-800 to-cyan-600",
  "from-orange-700 to-amber-500",
  "from-green-800 to-lime-600",
];

const STATUS_STYLES = [
  "bg-success-soft text-success", // Available
  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300", // Under offer
  "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300", // Rented
  "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300", // Sold
  "bg-surface-2 text-muted", // Withdrawn
];

function formatPrice(listing: Listing) {
  return `${formatEther(listing.priceWei)} ETH ${PRICE_PERIODS[listing.pricePeriod] ?? ""}`.trim();
}

// Loads a listing's details from IPFS. While loading, `metadata` is undefined;
// if it can't be loaded, it's null.
function useMetadata(cid: string) {
  const [metadata, setMetadata] = useState<ListingMetadata | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetchMetadata(cid).then((result) => {
      if (!cancelled) setMetadata(result);
    });
    return () => {
      cancelled = true;
    };
  }, [cid]);
  return metadata;
}

type Props = {
  listing: Listing;
  isMine: boolean;
  busy: boolean;
  onSetStatus: (id: bigint, status: number) => void;
};

export function ListingCard({ listing, isMine, busy, onSetStatus }: Props) {
  const metadata = useMetadata(listing.metadataCID);
  const [open, setOpen] = useState(false);
  const placeholder = PLACEHOLDERS[Number(listing.id % BigInt(PLACEHOLDERS.length))];
  const cover = metadata?.images[0];
  const inactive = listing.status === Status.Withdrawn;

  return (
    <>
      <article
        className={`group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
          inactive ? "opacity-60" : ""
        }`}
      >
        {/* Photo (from IPFS) or placeholder */}
        <button
          onClick={() => setOpen(true)}
          className={`relative flex h-44 items-center justify-center overflow-hidden bg-linear-to-br ${placeholder}`}
          aria-label="View details"
        >
          {cover ? (
            // A plain <img>: IPFS gateway images don't need Next's image optimiser.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={gatewayUrl(cover)}
              alt={metadata?.title ?? "Listing photo"}
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
          ) : (
            <HouseIcon className={`h-12 w-12 text-white/80 ${metadata === undefined ? "animate-pulse" : ""}`} />
          )}
          <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
            {LISTING_TYPES[listing.listingType]}
          </span>
          <span
            className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[listing.status]}`}
          >
            {STATUSES[listing.status]}
          </span>
          {metadata && metadata.images.length > 1 && (
            <span className="absolute bottom-3 right-3 rounded-full bg-black/45 px-2 py-0.5 text-xs text-white">
              {metadata.images.length} photos
            </span>
          )}
        </button>

        {/* Details */}
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {CATEGORIES[listing.category]}
              {listing.sizeSqm > 0 && ` · ${listing.sizeSqm.toLocaleString()} m²`}
            </p>
            <h3 className="mt-1 line-clamp-1 text-base font-semibold">
              {metadata?.title ?? (metadata === undefined ? "Loading…" : `Listing #${listing.id}`)}
            </h3>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
              <PinIcon className="h-4 w-4 shrink-0" />
              <span className="line-clamp-1">
                {metadata?.address ? `${metadata.address}, ` : ""}
                {listing.region}
              </span>
            </p>
          </div>

          <p className="text-xl font-bold text-accent">{formatPrice(listing)}</p>

          <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
            <span className="flex items-center gap-2 text-xs text-muted">
              <span className="font-mono">{shortAddress(listing.owner)}</span>
              {isMine && <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand">You</span>}
            </span>

            {/* Only the owner sees this control. The CONTRACT enforces the rule
                regardless (onlyListingOwner): the control is just a convenience */}
            {isMine && (
              <select
                value={listing.status}
                disabled={busy}
                onChange={(e) => onSetStatus(listing.id, Number(e.target.value))}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-medium disabled:opacity-50"
                aria-label="Change status"
              >
                {STATUSES.map((label, value) => (
                  <option key={label} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </article>

      {open && <ListingDetails listing={listing} metadata={metadata} onClose={() => setOpen(false)} />}
    </>
  );
}

// Full details in an overlay: description, all photos, amenities, and the
// on-chain facts that prove where the data comes from.
function ListingDetails({
  listing,
  metadata,
  onClose,
}: {
  listing: Listing;
  metadata: ListingMetadata | null | undefined;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {LISTING_TYPES[listing.listingType]} · {CATEGORIES[listing.category]}
            </p>
            <h2 className="mt-1 text-xl font-bold">{metadata?.title ?? `Listing #${listing.id}`}</h2>
            <p className="mt-1 text-sm text-muted">
              {metadata?.address ? `${metadata.address}, ` : ""}
              {listing.region}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-muted hover:text-foreground">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {metadata && metadata.images.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {metadata.images.map((cid, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={cid}
                src={gatewayUrl(cid)}
                alt={`Photo ${i + 1}`}
                className={`w-full rounded-xl object-cover ${i === 0 ? "col-span-2 h-64" : "h-36"}`}
              />
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-2xl font-bold text-accent">{formatPrice(listing)}</span>
          {listing.sizeSqm > 0 && <span className="text-sm text-muted">{listing.sizeSqm.toLocaleString()} m²</span>}
          <span className="text-sm text-muted">{STATUSES[listing.status]}</span>
        </div>

        {metadata?.description && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{metadata.description}</p>}

        {metadata && metadata.amenities.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {metadata.amenities.map((amenity) => (
              <span key={amenity} className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium">
                {amenity}
              </span>
            ))}
          </div>
        )}

        {/* Where each piece of data lives */}
        <dl className="mt-5 space-y-1.5 rounded-2xl bg-surface-2 p-4 font-mono text-xs text-muted">
          <div className="flex justify-between gap-4">
            <dt>Listing ID (on-chain)</dt>
            <dd>#{listing.id.toString()}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Owner (on-chain)</dt>
            <dd>{shortAddress(listing.owner)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Listed</dt>
            <dd>{new Date(Number(listing.createdAt) * 1000).toLocaleString()}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Details (IPFS CID)</dt>
            <dd className="truncate">
              <a href={gatewayUrl(listing.metadataCID)} target="_blank" rel="noreferrer" className="underline">
                {listing.metadataCID.slice(0, 12)}…
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="h-44 animate-pulse bg-surface-2" />
      <div className="space-y-3 p-4">
        <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
        <div className="h-6 w-1/3 animate-pulse rounded bg-surface-2" />
      </div>
    </div>
  );
}
