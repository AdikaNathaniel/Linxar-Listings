"use client";

import { useEffect, useState } from "react";
import { fetchMetadata, type ListingMetadata } from "../lib/ipfs";

// Loads a listing's or property's details from IPFS.
// While loading, the result is undefined; if it can't be loaded (or there's
// no CID), it's null.
export function useMetadata(cid: string | undefined) {
  const [loaded, setLoaded] = useState<{ cid: string; metadata: ListingMetadata | null } | null>(null);
  useEffect(() => {
    if (!cid) return;
    let cancelled = false;
    fetchMetadata(cid).then((metadata) => {
      if (!cancelled) setLoaded({ cid, metadata });
    });
    return () => {
      cancelled = true;
    };
  }, [cid]);
  if (!cid) return null;
  // Only use a result that belongs to the CID we're showing now
  return loaded?.cid === cid ? loaded.metadata : undefined;
}
