// =============================================================================
// Reading listing details from IPFS
// =============================================================================
// The contract stores only a CID (content identifier): a fingerprint of the
// listing's metadata JSON file. To show the title, description and photos,
// the website fetches that file through an IPFS GATEWAY, a normal web server
// that serves IPFS content over HTTPS.

// What we put in each listing's metadata file (see app/api/upload/route.ts).
export type ListingMetadata = {
  version: 1;
  title: string;
  description: string;
  address: string; // street / area, e.g. "East Legon"
  amenities: string[];
  images: string[]; // CIDs of the photos, each one also stored on IPFS
  // Property registration requests only: the deed number, so a verifier can
  // check it with the Lands Commission AND confirm it matches the on-chain
  // hash. ⚠️ Everything on IPFS is public; a real platform would share it
  // privately instead (e.g. over XMTP, Milestone 10).
  deedNumber?: string;
};

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL;

// cid → https://your-gateway.mypinata.cloud/ipfs/<cid>
export function gatewayUrl(cid: string): string {
  return GATEWAY ? `https://${GATEWAY}/ipfs/${cid}` : `https://ipfs.io/ipfs/${cid}`;
}

// A CID is derived from the file's contents, so the content behind a CID can
// NEVER change. That makes caching completely safe: once fetched, keep it.
const cache = new Map<string, Promise<ListingMetadata | null>>();

export function fetchMetadata(cid: string): Promise<ListingMetadata | null> {
  let pending = cache.get(cid);
  if (!pending) {
    pending = fetch(gatewayUrl(cid))
      .then((res) => (res.ok ? (res.json() as Promise<ListingMetadata>) : null))
      .catch(() => null) // unreachable, or not real metadata (e.g. a test CID)
      .then((metadata) => {
        if (!metadata) cache.delete(cid); // don't cache failures: retry next time
        return metadata;
      });
    cache.set(cid, pending);
  }
  return pending;
}
