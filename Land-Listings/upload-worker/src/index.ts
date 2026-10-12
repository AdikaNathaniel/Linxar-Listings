// =============================================================================
// LinXar upload Worker: puts a listing's photos and details on IPFS (via Pinata)
// =============================================================================
// Milestone 11: the website becomes STATIC FILES hosted on IPFS, so it can no
// longer contain server code. But uploading to Pinata needs the secret
// PINATA_JWT, and anything in browser code can be read by every visitor.
// So this one small job lives here instead: a Cloudflare Worker, a tiny
// serverless function running on Cloudflare's network. It's the same code
// as the old web/app/api/upload/route.ts.
//
// It's the ONLY centralised piece of LinXar, and it's only needed for
// UPLOADING. Browsing, buying, escrow, verification and chat all keep
// working without it.
//
// Flow:
//   1. The browser sends the photos + text details here.
//   2. Each NEW photo is uploaded to IPFS → one CID per photo. (Photos
//      already on IPFS, e.g. a property's, are passed as CIDs and reused.)
//   3. A metadata JSON file (title, description, amenities, photo CIDs) is
//      uploaded too → ONE CID for the whole listing.
//   4. That metadataCID is returned; the browser puts it on-chain.
// =============================================================================

// Set with `npx wrangler secret put PINATA_JWT`: stored encrypted by
// Cloudflare, never in the code or on GitHub.
type Env = { PINATA_JWT: string };

type ListingMetadata = {
  version: 1;
  title: string;
  description: string;
  address: string;
  amenities: string[];
  images: string[];
  deedNumber?: string;
};

const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB per photo

// CORS: browsers only let a page on one site (e.g. the IPFS gateway hosting
// LinXar) read responses from ANOTHER site (this Worker) if the other site
// says so. "*" = any site may call us. The website lives at a different
// address for every IPFS version (each has its own CID), so we can't list them.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// Uploads one file to IPFS through Pinata and returns its CID
async function pinToIpfs(file: Blob, name: string, jwt: string): Promise<string> {
  const body = new FormData();
  body.append("file", file, name);
  body.append("name", name);
  body.append("network", "public"); // anyone can fetch it by CID, through any gateway
  const res = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body,
  });
  if (!res.ok) throw new Error(`Pinata upload failed (${res.status}): ${await res.text()}`);
  const result = (await res.json()) as { data: { cid: string } };
  return result.data.cid;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // The browser may first ask "am I allowed to POST here?" (a CORS preflight)
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
    if (request.method !== "POST") return json({ error: "Use POST" }, 405);
    if (!env.PINATA_JWT) return json({ error: "PINATA_JWT secret is not set on the Worker" }, 500);

    const form = await request.formData();
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const address = String(form.get("address") ?? "").trim();
    const deedNumber = String(form.get("deedNumber") ?? "").trim();
    const amenities = form.getAll("amenities").map(String);
    const existingImages = form.getAll("existingImages").map(String);
    const photos = form.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0);

    if (!title) return json({ error: "A title is required." }, 400);
    if (photos.length + existingImages.length === 0) return json({ error: "Add at least one photo." }, 400);
    if (photos.length > MAX_PHOTOS) return json({ error: `Add at most ${MAX_PHOTOS} new photos.` }, 400);
    for (const cid of existingImages) {
      if (!/^[a-zA-Z0-9]{20,100}$/.test(cid)) return json({ error: "Invalid photo CID." }, 400);
    }
    for (const photo of photos) {
      if (!photo.type.startsWith("image/")) return json({ error: `"${photo.name}" isn't an image.` }, 400);
      if (photo.size > MAX_PHOTO_BYTES) return json({ error: `"${photo.name}" is larger than 5 MB.` }, 400);
    }

    try {
      const images = [...existingImages];
      for (const photo of photos) images.push(await pinToIpfs(photo, photo.name, env.PINATA_JWT));

      const metadata: ListingMetadata = {
        version: 1,
        title,
        description,
        address,
        amenities,
        images,
        ...(deedNumber ? { deedNumber } : {}),
      };
      const file = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
      const metadataCID = await pinToIpfs(file, `${title.slice(0, 40)}.json`, env.PINATA_JWT);
      return json({ metadataCID });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  },
};
