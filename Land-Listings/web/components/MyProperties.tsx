"use client";

import type { Hex } from "viem";
import { gatewayUrl } from "../lib/ipfs";
import { HouseIcon } from "./icons";
import { useMetadata } from "./useMetadata";

// One property NFT owned by the connected wallet
export type OwnedProperty = {
  id: bigint; // the NFT's token id
  deedHash: Hex;
  metadataCID: string;
  registeredAt: bigint;
};

type Props = {
  properties: OwnedProperty[];
  onList: (propertyId: bigint) => void;
};

// "My properties": the NFTs this wallet owns, each one ready to be listed
export function MyProperties({ properties, onList }: Props) {
  if (properties.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">My properties</h2>
        <p className="text-sm text-muted">
          Property NFTs owned by your wallet. Only you (or an agent you approve) can list them.
        </p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {properties.map((property) => (
          <PropertyChip key={property.id.toString()} property={property} onList={onList} />
        ))}
      </div>
    </section>
  );
}

function PropertyChip({ property, onList }: { property: OwnedProperty; onList: (id: bigint) => void }) {
  const metadata = useMetadata(property.metadataCID);
  const cover = metadata?.images[0];
  return (
    <div className="flex w-64 shrink-0 items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-soft text-brand">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={gatewayUrl(cover)} alt="" className="h-full w-full object-cover" />
        ) : (
          <HouseIcon className="h-6 w-6" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-muted">NFT #{property.id.toString()}</p>
        <p className="truncate text-sm font-semibold">{metadata?.title ?? "Loading…"}</p>
        <button onClick={() => onList(property.id)} className="text-xs font-semibold text-brand hover:underline">
          List it →
        </button>
      </div>
    </div>
  );
}
