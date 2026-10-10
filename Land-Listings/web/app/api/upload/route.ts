// =============================================================================
// POST /api/upload: puts a listing's photos and details on IPFS (via Pinata)
// =============================================================================
// This is the ONE piece of LinXar that runs on a server instead of in the
// browser. It has to: uploading to Pinata needs your secret PINATA_JWT, and
// anything in browser code can be read by every visitor.
//
// Flow:
//   1. The browser sends the photos + text details here (and, when listing a
//      property, the CIDs of the photos it was registered with).
//   2. Each NEW photo is uploaded to IPFS → we get back one CID per photo.
//   3. A metadata JSON file (title, description, amenities, photo CIDs) is
//      uploaded too → we get back ONE CID for the whole listing.
//   4. That single metadataCID is returned to the browser, which then puts it
//      on-chain with createListing(). On-chain cost: one short string,
//      instead of megabytes of photos.
//
// ⚠️ While learning, this runs on your own computer (`npm run dev`). In
// Milestone 11 the site becomes static files, and this job moves to a tiny
// serverless function. Note that anyone who can reach this endpoint can use
// your Pinata storage, which is fine locally but not for a public site.
// =============================================================================

import type { ListingMetadata } from "../../../lib/ipfs";

const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB per photo

// Uploads one file to IPFS through Pinata and returns its CID.
async function pinToIpfs(file: Blob, name: string, jwt: string): Promise<string> {
  const body = new FormData();
  body.append("file", file, name);
  body.append("name", name);
  // "public" = anyone can fetch it by CID through any IPFS gateway.
  // (Pinata's default is "private", which gateways won't serve openly.)
  body.append("network", "public");

  const res = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` }, // proves the upload is yours
    body,
  });
  if (!res.ok) {
    throw new Error(`Pinata upload failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { data: { cid: string } };
  return json.data.cid;
}

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

export async function POST(request: Request) {
  // Read from web/.env.local. Only server code can see this; it never
  // reaches the browser, because it doesn't start with NEXT_PUBLIC_.
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    return Response.json({ error: "PINATA_JWT is missing from web/.env.local" }, { status: 500 });
  }

  const form = await request.formData();
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const address = String(form.get("address") ?? "").trim();
  const amenities = form.getAll("amenities").map(String);
  const photos = form
    .getAll("photos")
    .filter((item): item is File => item instanceof File && item.size > 0);
  // Photos ALREADY on IPFS (e.g. from the property's registration), sent as
  // CIDs. They don't need uploading again: the new metadata just points to
  // the same CIDs. A file on IPFS can be referenced any number of times.
  const existingImages = form.getAll("existingImages").map(String);

  if (!title) return badRequest("A title is required.");
  if (photos.length + existingImages.length === 0) return badRequest("Add at least one photo.");
  if (photos.length + existingImages.length > MAX_PHOTOS * 2) return badRequest("Too many photos.");
  if (photos.length > MAX_PHOTOS) return badRequest(`Add at most ${MAX_PHOTOS} new photos.`);
  for (const cid of existingImages) {
    // A CID is letters and digits only. Reject anything else, so nobody can
    // slip odd text into our metadata.
    if (!/^[a-zA-Z0-9]{20,100}$/.test(cid)) return badRequest("Invalid photo CID.");
  }
  for (const photo of photos) {
    if (!photo.type.startsWith("image/")) return badRequest(`"${photo.name}" isn't an image.`);
    if (photo.size > MAX_PHOTO_BYTES) return badRequest(`"${photo.name}" is larger than 5 MB.`);
  }

  try {
    // Step 2: one CID per NEW photo, added after any existing ones
    const images: string[] = [...existingImages];
    for (const photo of photos) {
      images.push(await pinToIpfs(photo, photo.name, jwt));
    }

    // Step 3: the metadata file that ties everything together
    const metadata: ListingMetadata = { version: 1, title, description, address, amenities, images };
    const metadataFile = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
    const metadataCID = await pinToIpfs(metadataFile, `${title.slice(0, 40)}.json`, jwt);

    // Step 4: hand the CID back to the browser
    return Response.json({ metadataCID });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
