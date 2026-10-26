# LinXar Listings

**A decentralised property listing and escrow platform on Ethereum.** Properties are registered as NFTs, listings live on-chain, payments are held by a smart contract escrow, and agents carry verification badges that can't be faked.

🌐 **Live app:** https://linxar.linxar-listings.workers.dev  (Sepolia testnet, so you'll need MetaMask and some Sepolia test ETH)
📦 **Source:** https://github.com/AdikaNathaniel/Linxar-Listings

---

## The problem

Buying, renting or leasing property, and land in particular, depends heavily on trust, and that trust is often abused:

- **Double selling.** The same plot is sold to several buyers, because nobody can easily check who owns it or whether it has already been sold.
- **Forged documents.** Title deeds and ownership papers are faked, and the buyer only finds out after paying.
- **Fake agents.** Anyone can call themselves an agent. Buyers can't tell a licensed agent from a scammer.
- **Lost deposits.** Buyers pay deposits or the full price straight to the seller or agent. If the deal falls through, there's often no way to get the money back.
- **Opaque records.** Ownership records are held centrally, so they're hard for the public to check and easy to tamper with.

## The solution

LinXar replaces trust in people with rules in code that anyone can check:

| Problem | How LinXar solves it |
|---|---|
| Double selling | Each property is a unique **ERC-721 NFT**. Its deed number is hashed and locked on-chain, so the same deed can never be registered twice. |
| Forged documents | Owners **request** registration, and only an approved **verifier** can approve it and mint the property NFT. Rejections are public, with a reason. |
| Fake agents | Verified agents receive a **soulbound badge**: an NFT that can't be transferred, sold or faked, and that a verifier can revoke. |
| Lost deposits | Buyers' money goes into an **escrow smart contract**, not to the seller. It's released only when the deal completes, and refunded if it doesn't. |
| Opaque records | Every property, listing and deal is on a public blockchain and indexed with **The Graph**, so anyone can check them. |

The app is **fully web3**: there's no backend server or database of its own. The browser talks straight to the blockchain through MetaMask.

---

## Features

### For property owners
- Request registration of a property: deed number, title, description, address and photos (stored on IPFS).
- Track requests (Pending / Approved / Rejected with a reason).
- See owned property NFTs and create listings for them.
- Appoint an agent to list on their behalf (standard ERC-721 `approve` / `setApprovalForAll`).

### For buyers and tenants
- Browse listings, filtered by type (**Sale / Rent / Lease**), category (**Residential / Commercial / Industrial / Land**), region, price and size.
- See at a glance whether the lister is a **✔ Verified Agent**.
- Open an escrow deal: pay the exact price for a sale, or a deposit for a rental.
- Confirm the deal, cancel it before the seller accepts, or raise a dispute.
- Message the seller privately, wallet to wallet (XMTP).

### For verifiers and arbiters
- **Verifier panel:** approve or reject property registrations; issue or revoke agent badges.
- **Arbiter:** settle disputed deals by paying the seller or refunding the buyer.

---

## Architecture

```
                        ┌───────────────────────────────┐
   Browser + MetaMask   │  Next.js static site (IPFS)   │
   ─────────────────────┤  served at a stable address   │
                        │  by the "front door" Worker   │
                        └──────┬───────────┬────────────┘
              writes (txs)     │           │ reads (GraphQL)
                               ▼           ▼
   ┌──────────────────────────────┐   ┌────────────────────┐
   │  Ethereum (Sepolia)          │──▶│  The Graph         │
   │  PropertyRegistry  (ERC-721) │   │  subgraph "lin-xar"│
   │  ListingBoard                │   └────────────────────┘
   │  Escrow                      │
   │  AgentBadge (soulbound)      │   ┌────────────────────┐
   └──────────────────────────────┘   │  XMTP network      │◀── wallet-to-wallet chat
                                      └────────────────────┘
   photos + metadata ──▶ Upload Worker ──▶ Pinata ──▶ IPFS
```

| Layer | Technology | Purpose |
|---|---|---|
| Smart contracts | Solidity 0.8, OpenZeppelin 5, Hardhat 3, viem | Ownership, listings, escrow, badges |
| Network | Ethereum **Sepolia** testnet (contracts verified on Etherscan) | Public, permanent record |
| Indexing | **The Graph** (Subgraph Studio) | Fast, filterable queries over contract events |
| Storage | **IPFS** via Pinata | Photos, listing metadata, the website itself |
| Messaging | **XMTP** browser SDK | Private, end-to-end encrypted buyer–seller chat |
| Frontend | Next.js 16 (static export), React 19, Tailwind CSS 4, viem | The dApp |
| Wallet | MetaMask | Signing transactions, identity |
| Edge | Cloudflare Workers + KV | Upload proxy and stable site address |
| CI/CD | GitHub Actions | Build, publish to IPFS, go live |

---

## Smart contracts

All four contracts live in [Land-Listings/contracts/contracts](contracts/contracts) and are deployed together by one Hardhat Ignition module ([LinXar.ts](contracts/ignition/modules/LinXar.ts)).

### 1. PropertyRegistry: properties as NFTs (`LXP`)
ERC-721 + AccessControl. Each token is one real property.

- `requestRegistration(deedHash, metadataCID)`: anyone applies, with their documents on IPFS.
- `approveRegistration(requestId)`: **VERIFIER_ROLE** only. Mints the NFT to the applicant.
- `rejectRegistration(requestId, reason)`: **VERIFIER_ROLE** only, with a public reason.
- **Duplicate protection:** only the `keccak256` hash of the deed number is stored. Once a deed is registered it's locked forever, so if the real owner and a scammer both apply, only the first approval can succeed. The frontend normalises deed numbers (capitals, dashes) before hashing, so `ga-12345 2019` and `GA-12345-2019` can't slip past the check.

### 2. ListingBoard: on-chain listings
- `createListing(...)`: only the property's **owner**, or an **agent** the owner approved, can list it. ListingBoard checks this by calling PropertyRegistry directly (contract composability).
- Listing types: **Sale, Rent, Lease**. Categories: **Residential, Commercial, Industrial, Land**. Price periods: **one-off, per month, per year**.
- Statuses: **Available, UnderOffer, Rented, Sold, Withdrawn**.
- `updateListing` and `setStatus` are restricted to the listing's owner.

### 3. Escrow: safe payments (`ReentrancyGuard` + AccessControl)
Holds the buyer's ETH until the deal is settled. Nobody, not even the seller or agent, can touch locked funds.

```
 openDeal ──▶ Funded ──acceptDeal──▶ Accepted ──confirmDeal / finalizeAfterTimeout──▶ Completed
                │                       │
     cancelDeal / rejectDeal       raiseDispute
                │                       ▼
                ▼                   Disputed ──resolveDispute (ARBITER)──▶ Completed / Refunded
            Refunded
```

- **Sale → Purchase:** the buyer must send the exact price. On completion, the **property NFT moves to the buyer and the payment goes to the seller in the same transaction**: both happen or neither does.
- **Rent/Lease → RentalDeposit:** any non-zero deposit.
- Before accepting a sale, the seller must approve the escrow to transfer the NFT, so the handover can't fail later.
- **7-day confirmation window:** if the buyer goes silent after acceptance, the seller can finalise after 7 days.
- **Disputes:** either party can raise one, and an account with **ARBITER_ROLE** settles it.
- **Pull payments:** completing or refunding only records what each address is owed. Funds leave through `withdraw()`, following checks-effects-interactions and protected by `nonReentrant`.

### 4. AgentBadge: soulbound verification (`LXA`)
- `issueBadge(agent, profileCID)` / `revokeBadge(agent)`: **VERIFIER_ROLE** only.
- The token ID is the agent's address, so `isVerified(agent)` is a direct, free lookup.
- **Soulbound:** `_update` is overridden so badges can be minted and burned, but never transferred.

### Roles
| Role | Contract(s) | Can |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | all with AccessControl | Grant and revoke other roles without redeploying |
| `VERIFIER_ROLE` | PropertyRegistry, AgentBadge | Approve/reject properties, issue/revoke badges |
| `ARBITER_ROLE` | Escrow | Resolve disputes |

Role holders for each network are set in [ignition/parameters](contracts/ignition/parameters).

### Sepolia deployment
| Contract | Address |
|---|---|
| PropertyRegistry | [`0x72a2A1AEe1C721C21a3Fcfe04C0B0aB49DD397B5`](https://sepolia.etherscan.io/address/0x72a2A1AEe1C721C21a3Fcfe04C0B0aB49DD397B5) |
| ListingBoard | [`0x9905754587D013dd011900D1FacC721c1f772AdF`](https://sepolia.etherscan.io/address/0x9905754587D013dd011900D1FacC721c1f772AdF) |
| Escrow | [`0xe876E1175502a8F7d0f7918a6214B98416a1496F`](https://sepolia.etherscan.io/address/0xe876E1175502a8F7d0f7918a6214B98416a1496F) |
| AgentBadge | [`0xe306229ab438109dA39c293f0f9E977c7f9B9863`](https://sepolia.etherscan.io/address/0xe306229ab438109dA39c293f0f9E977c7f9B9863) |

### Tests
**54 tests** across the four contracts (Hardhat 3, `node:test`, viem), covering the happy paths, access control, invalid input, the escrow state machine, the timeout window, disputes, and a **reentrancy attack**: a deliberately malicious contract ([ReentrancyAttacker.sol](contracts/contracts/testing/ReentrancyAttacker.sol)) tries to drain the escrow during `withdraw()` and fails.

---

## Off-chain components

### Subgraph (The Graph)
[Land-Listings/subgraph](subgraph) indexes every contract event into queryable entities: `Property`, `RegistrationRequest`, `Listing`, `Deal`, `Account` and `Agent`. The website reads from it with GraphQL, which gives fast filtering and sorting, rejection reasons (stored only in events), and each listing's agent status in one request. Published on Subgraph Studio as `lin-xar`.

### Upload Worker
[Land-Listings/upload-worker](upload-worker) is a Cloudflare Worker that uploads photos (up to 6, 5 MB each) and a metadata JSON to IPFS through Pinata, then returns the metadata CID that goes on-chain. It exists because the Pinata key must stay secret, and a static site can't hold secrets. It's the **only centralised piece**, and only uploading needs it: browsing, buying, escrow, verification and chat all work without it.

### Site Worker: a stable address
[Land-Listings/site-worker](site-worker) is a Cloudflare Worker behind https://linxar.linxar-listings.workers.dev. Every deploy publishes the site to IPFS under a new CID. The Worker reads the latest CID from Cloudflare KV and serves that version from public IPFS gateways, with fallback between gateways if one is busy. The address never changes, so MetaMask and XMTP stay connected across releases. `/_version` shows the live CID and permanent IPFS links.

### Messaging (XMTP)
Buyers and sellers chat wallet to wallet over the XMTP network, end-to-end encrypted, with no chat server.

---

## Deployment pipeline

On every push to `main` that touches the website, [.github/workflows/deploy-site.yml](../.github/workflows/deploy-site.yml):

1. Checks that the site points at the **Sepolia** contracts, not a local chain.
2. Checks that all required settings are present, without printing them.
3. Builds the Next.js app as static files (`output: "export"`).
4. Publishes `web/out/` to **IPFS** through Pinata and records the new CID.
5. Writes the CID to Cloudflare KV, so the stable address serves the new version.

---

## Project structure

```
Land-Listings/
├── contracts/        Solidity contracts, tests, Ignition deployment, export scripts
├── subgraph/         The Graph schema, mappings and manifest
├── web/              Next.js dApp (app/, components/, lib/)
├── upload-worker/    Cloudflare Worker: photo/metadata upload to IPFS
└── site-worker/      Cloudflare Worker: stable address for the latest IPFS build
```

---

## Running locally

**Prerequisites:** Node.js 22+, MetaMask.

```bash
# 1. Contracts: start a local chain and deploy
cd contracts
npm install
npm test                      # run the 54 tests
npm run chain                 # terminal 1: local Hardhat node on 127.0.0.1:8545
npm run deploy:local          # terminal 2: deploy + write addresses into web/lib/contracts.generated.ts

# 2. Website
cd ../web
npm install
npm run dev                   # http://localhost:3000
```

Add the Hardhat network (RPC `http://127.0.0.1:8545`, chain ID `31337`) to MetaMask and import one of the test accounts that `npm run chain` prints. On the local chain the site reads the contracts directly, so no subgraph is needed.

### Environment variables (`web/.env.local`)
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SEPOLIA_RPC_URL` | Sepolia RPC endpoint (e.g. Alchemy) |
| `NEXT_PUBLIC_GATEWAY_URL` | IPFS gateway used to display images |
| `NEXT_PUBLIC_UPLOAD_URL` | URL of the upload Worker |
| `NEXT_PUBLIC_SUBGRAPH_URL` | *(optional)* override the default subgraph URL |

### Deploying to Sepolia
```bash
cd contracts
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
npx hardhat keystore set ETHERSCAN_API_KEY
npm run deploy:sepolia        # deploy, verify on Etherscan, export addresses to web/
```
After a redeploy, update the addresses and start blocks in `subgraph/subgraph.yaml`, then run `npm run codegen && npm run build && npm run deploy` in `subgraph/`.

Switch the website between networks with `npm run use:local` or `npm run use:sepolia` in `contracts/`.

---

## Security highlights

- **Role-based access control** (OpenZeppelin `AccessControl`) for verifiers, arbiters and admins.
- **Checks-effects-interactions** and **`ReentrancyGuard`** on all fund movements, with a reentrancy attack test.
- **Pull payments**, so a failing recipient can never block a deal.
- **Atomic settlement:** property and payment move in one transaction, or not at all.
- **Custom errors** for clear, gas-efficient reverts.
- **No secrets in the frontend:** the Pinata key lives only in a Cloudflare Worker secret and GitHub Actions secrets.

---

## Roadmap

Built in 11 milestones: listings → property NFTs → agent delegation → escrow → verification roles → agent badges → Sepolia → The Graph → XMTP chat → IPFS hosting. Possible next steps:

- Multiple verifiers and arbiters (e.g. a multisig or DAO) instead of single accounts.
- Partial and instalment payments for rentals.
- Deployment to an L2 (Base, Optimism or Arbitrum) for lower fees.
- A security audit before any mainnet use.

> ⚠️ **Testnet only.** LinXar is a learning project deployed on Sepolia. It hasn't been audited and must not be used with real funds.

---

## Author

**Nathaniel Adika**: [github.com/AdikaNathaniel](https://github.com/AdikaNathaniel)
