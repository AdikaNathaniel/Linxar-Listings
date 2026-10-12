// =============================================================================
// Publishes the built website (web/out/) to IPFS through Pinata
// =============================================================================
// Usage (after `npm run build`):   PINATA_JWT=… node scripts/pin-site.mjs
// The GitHub Action (.github/workflows/deploy-site.yml) runs this on every push.
//
// IPFS stores content by FINGERPRINT (CID). Uploading the whole `out` folder
// gives ONE CID for the entire site. Change any file, and the next upload
// gets a NEW CID. Old versions stay reachable at their own CIDs, unchanged.
// =============================================================================

import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve(import.meta.dirname, "..", "out");
const PIN_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

const jwt = process.env.PINATA_JWT;
if (!jwt) {
  console.error("PINATA_JWT is not set.");
  process.exit(1);
}

// Every file under out/, with its path relative to out/
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

const files = listFiles(OUT_DIR);
const name = `linxar-site-${process.env.GITHUB_SHA?.slice(0, 7) ?? new Date().toISOString().slice(0, 16)}`;
console.log(`Uploading ${files.length} files from ${OUT_DIR} as "${name}"…`);

// A FOLDER upload: every file's name starts with the same folder ("out/…"),
// so Pinata stores them as one directory and returns the directory's CID.
const form = new FormData();
for (const file of files) {
  const relative = path.relative(OUT_DIR, file).split(path.sep).join("/");
  form.append("file", new Blob([readFileSync(file)]), `out/${relative}`);
}
form.append("pinataMetadata", JSON.stringify({ name }));
// CID version 1 ("bafy…"): required for subdomain gateways like
// https://<cid>.ipfs.dweb.link/, where the site sits at the root of the address
form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

const res = await fetch(PIN_URL, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: form });
if (!res.ok) {
  console.error(`Pinata upload failed (${res.status}): ${await res.text()}`);
  process.exit(1);
}
const { IpfsHash: cid } = await res.json();

const links = [`https://${cid}.ipfs.dweb.link/`, `https://${cid}.ipfs.w3s.link/`];
console.log(`\n✔ Site published to IPFS\n  CID: ${cid}\n  ${links.join("\n  ")}`);

// In GitHub Actions: expose the CID to later steps, and show the links on the
// run's summary page
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `cid=${cid}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## 🚀 LinXar published to IPFS\n\n**CID:** \`${cid}\`\n\n${links.map((l) => `- ${l}`).join("\n")}\n`,
  );
}
