// "use client" makes this page run in the user's BROWSER, not on a server.
// It has to: MetaMask lives in the browser, and in a dApp the browser talks
// directly to the blockchain. There is no backend server in between.
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createWalletClient,
  custom,
  parseEther,
  formatEther,
  toHex,
  parseEventLogs,
  BaseError,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";
// Milestone 8: WHICH chain (local or Sepolia) and the client that reads from
// it now live in lib/chain.ts, decided by the last exported deployment.
import { chain, isLocal, publicClient, POLL_MS, DEPLOY_BLOCK, explorerAddressUrl, explorerTxUrl } from "../lib/chain";
// Milestone 9: on Sepolia, reads come from our subgraph on The Graph
import {
  graphDeals,
  graphListings,
  graphOwnedProperties,
  graphRejectionReason,
  graphRequests,
  graphVerifiedAgents,
  waitForIndexing,
} from "../lib/subgraph";
import { LISTING_BOARD_ADDRESS, listingBoardAbi } from "../lib/listingBoard";
import { PROPERTY_REGISTRY_ADDRESS, propertyRegistryAbi } from "../lib/propertyRegistry";
import { ESCROW_ADDRESS, escrowAbi, DealKind, DealStatus, type Deal, type DealAction } from "../lib/escrow";
import { DealsPanel } from "../components/DealsPanel";
import { AGENT_BADGE_ADDRESS, agentBadgeAbi } from "../lib/agentBadge";
import { MyRequests, RequestStatus, type RegistrationRequest } from "../components/MyRequests";
import { VerifierPanel, type BadgeFormValues } from "../components/VerifierPanel";
// Milestone 10: wallet-to-wallet messaging over XMTP
import { ChatPanel, type ChatTarget } from "../components/ChatPanel";
import { canMessage, connectXmtp, isPublicTestAccount, type XmtpClient } from "../lib/xmtp";
import { deedHash, normalizeDeedNumber } from "../lib/deed";
import { CATEGORIES, LISTING_TYPES, REGIONS, STATUSES, Status } from "../lib/listingOptions";
import { ListingCard, ListingCardSkeleton, shortAddress, type Listing } from "../components/ListingCard";
import { CreateListingForm, type ListingFormValues } from "../components/CreateListingForm";
import { RegisterPropertyForm, type PropertyFormValues } from "../components/RegisterPropertyForm";
import { MyProperties, type OwnedProperty } from "../components/MyProperties";
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  HouseIcon,
  InfoIcon,
  LogoMark,
  Spinner,
  WalletIcon,
} from "../components/icons";

// -----------------------------------------------------------------------------
// MetaMask injects an object called `window.ethereum` into every web page.
// It's the bridge between websites and the wallet. This line just tells
// TypeScript that it exists (it's undefined if MetaMask isn't installed).
// -----------------------------------------------------------------------------
declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

// Turns any error into a short, readable message for the user.
// viem's errors have a `shortMessage`, e.g. "User rejected the request.",
// or name the contract's custom error, e.g. NotListingOwner.
function errorMessage(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage;
  if (err instanceof Error) return err.message;
  return String(err);
}

class ContractNotDeployedError extends Error {
  constructor() {
    super(
      isLocal
        ? "ListingBoard isn't deployed on your local chain. In the contracts folder, run `npm run deploy:local`, then refresh this page."
        : `ListingBoard isn't deployed on ${chain.name} at this address. In the contracts folder, run \`npm run deploy:sepolia\` (or \`npm run use:local\` to go back to your local chain).`,
    );
  }
}

// -----------------------------------------------------------------------------
// EVENTUAL CONSISTENCY (Milestone 9): on Sepolia our reads come from The
// Graph, which needs a few seconds to index each new block. So after new
// events or a transaction, wait until it has reached that block before
// re-reading. (Locally we read the contracts directly, so no waiting.)
// -----------------------------------------------------------------------------
async function synced(blockNumber: bigint | null | undefined): Promise<void> {
  if (!isLocal && blockNumber) await waitForIndexing(blockNumber);
}

// The newest block among a batch of event logs
function latestBlock(logs: { blockNumber: bigint | null }[]): bigint {
  return logs.reduce((max, log) => (log.blockNumber && log.blockNumber > max ? log.blockNumber : max), 0n);
}

// -----------------------------------------------------------------------------
// READ: fetch every listing from the contract
// -----------------------------------------------------------------------------
// `readContract` calls a `view` function. These are free CALLS, not
// transactions, which is why the page can show listings before anyone
// connects a wallet.
async function fetchListings(): Promise<Listing[]> {
  // First check there's actually a contract at that address. After you
  // restart `npx hardhat node` the chain starts empty, so the address points
  // at nothing until you deploy again. `getCode` returns the contract's
  // bytecode, or nothing if no contract lives there.
  const code = await publicClient.getCode({ address: LISTING_BOARD_ADDRESS });
  if (!code) throw new ContractNotDeployedError();

  // Milestone 9: on Sepolia, ONE GraphQL query to The Graph replaces the
  // loop below (which needs one RPC call per listing).
  if (!isLocal) return graphListings();

  const total = await publicClient.readContract({
    address: LISTING_BOARD_ADDRESS, // WHERE the contract is
    abi: listingBoardAbi,           // WHAT functions it has
    functionName: "totalListings",  // WHICH function to call
  });

  // Fetch listings one at a time, by id: 0, 1, 2, ...
  // (Fine for a handful on the local chain. On Sepolia, The Graph is used instead.)
  const items: Listing[] = [];
  for (let id = 0n; id < total; id++) {
    const listing = await publicClient.readContract({
      address: LISTING_BOARD_ADDRESS,
      abi: listingBoardAbi,
      functionName: "getListing",
      args: [id], // function arguments always go in an array, in order
    });
    items.push(listing);
  }
  return items.reverse(); // newest first
}

// -----------------------------------------------------------------------------
// READ: which property NFTs does this wallet own?
// -----------------------------------------------------------------------------
// We ask the registry `ownerOf(id)` for every property and keep the ones that
// belong to `owner`. Fine for a handful; in Milestone 9, The Graph answers
// this instantly from the ERC-721 Transfer events.
async function fetchOwnedProperties(owner: Address): Promise<OwnedProperty[]> {
  if (!isLocal) return graphOwnedProperties(owner); // Milestone 9: one query
  const total = await publicClient.readContract({
    address: PROPERTY_REGISTRY_ADDRESS,
    abi: propertyRegistryAbi,
    functionName: "totalProperties",
  });
  const owned: OwnedProperty[] = [];
  for (let id = 0n; id < total; id++) {
    const holder = await publicClient.readContract({
      address: PROPERTY_REGISTRY_ADDRESS,
      abi: propertyRegistryAbi,
      functionName: "ownerOf", // a standard ERC-721 function, inherited from OpenZeppelin
      args: [id],
    });
    if (holder.toLowerCase() !== owner.toLowerCase()) continue;
    const property = await publicClient.readContract({
      address: PROPERTY_REGISTRY_ADDRESS,
      abi: propertyRegistryAbi,
      functionName: "getProperty",
      args: [id],
    });
    owned.push({ id, ...property });
  }
  return owned;
}

// -----------------------------------------------------------------------------
// READ: every property registration request (Milestone 7)
// -----------------------------------------------------------------------------
// Owners see their own; verifiers see the pending ones to review.
async function fetchRequests(): Promise<RegistrationRequest[]> {
  if (!isLocal) return graphRequests(); // Milestone 9: one query
  const total = await publicClient.readContract({
    address: PROPERTY_REGISTRY_ADDRESS,
    abi: propertyRegistryAbi,
    functionName: "totalRequests",
  });
  const requests: RegistrationRequest[] = [];
  for (let id = 0n; id < total; id++) {
    requests.push(
      await publicClient.readContract({
        address: PROPERTY_REGISTRY_ADDRESS,
        abi: propertyRegistryAbi,
        functionName: "getRequest",
        args: [id],
      }),
    );
  }
  return requests.reverse(); // newest first
}

// The verifier's reason for a rejection is NOT kept in contract storage (that
// would cost gas for no reason), only in the RegistrationRejected EVENT. So
// we search the event logs: `args` filters on the INDEXED requestId, and
// `fromBlock: DEPLOY_BLOCK` means "search from the block our contracts were
// deployed in" (on Sepolia, searching all of history would be far too slow).
async function fetchRejectionReason(requestId: bigint): Promise<string | null> {
  // Milestone 9: the subgraph saved the reason from the event already
  if (!isLocal) return graphRejectionReason(requestId);
  const [event] = await publicClient.getContractEvents({
    address: PROPERTY_REGISTRY_ADDRESS,
    abi: propertyRegistryAbi,
    eventName: "RegistrationRejected",
    args: { requestId },
    fromBlock: DEPLOY_BLOCK,
  });
  return event?.args.reason ?? null;
}

// -----------------------------------------------------------------------------
// READ: which of these addresses hold a Verified Agent badge?
// -----------------------------------------------------------------------------
async function fetchVerifiedAgents(addresses: Address[]): Promise<Set<string>> {
  if (!isLocal) return graphVerifiedAgents(addresses); // Milestone 9: one query
  const unique =[...new Set(addresses.map((a) => a.toLowerCase()))] as Address[];
  const results = await Promise.all(
    unique.map((agent) =>
      publicClient.readContract({
        address: AGENT_BADGE_ADDRESS,
        abi: agentBadgeAbi,
        functionName: "isVerified", // a free read: anyone can check a badge
        args: [agent],
      }),
    ),
  );
  return new Set(unique.filter((_, i) => results[i]));
}

// -----------------------------------------------------------------------------
// READ: the escrow deals this wallet is part of, and what it's owed
// -----------------------------------------------------------------------------
// The arbiter also sees every DISPUTED deal, because they have to decide them.
async function fetchDeals(
  account: Address,
  isArbiter: boolean,
): Promise<{ deals: Deal[]; pending: bigint; chainTime: bigint }> {
  // Milestone 9: on Sepolia, deals AND the amount owed come from one query.
  // (The chain's clock still comes from the latest block, as below.)
  if (!isLocal) {
    const [{ deals, pending }, { timestamp: chainTime }] = await Promise.all([
      graphDeals(account, isArbiter),
      publicClient.getBlock(),
    ]);
    return { deals, pending, chainTime };
  }

  const total = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "totalDeals",
  });
  const me = account.toLowerCase();
  const deals: Deal[] = [];
  for (let id = 0n; id < total; id++) {
    const deal = await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "getDeal",
      args: [id],
    });
    const mine = deal.buyer.toLowerCase() === me || deal.seller.toLowerCase() === me;
    if (mine || (isArbiter && deal.status === DealStatus.Disputed)) deals.push(deal);
  }
  // pendingWithdrawals is a PUBLIC mapping, so Solidity gave it a free
  // read function automatically: pendingWithdrawals(address) → amount
  const pending = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "pendingWithdrawals",
    args: [account],
  });
  // The BLOCKCHAIN's clock, not the computer's: contracts compare deadlines
  // against block.timestamp, so the website must too. (They can differ, e.g.
  // a test chain can be fast-forwarded.)
  const { timestamp: chainTime } = await publicClient.getBlock();
  return { deals: deals.reverse(), pending, chainTime };
}

// -----------------------------------------------------------------------------
// OFF-CHAIN: upload photos + details to IPFS, get back ONE fingerprint (CID)
// -----------------------------------------------------------------------------
// Milestone 11: this goes to our Cloudflare Worker (Land-Listings/upload-worker),
// which holds the secret Pinata key and does the actual upload. The website
// itself is now static files on IPFS, so it can't hold secrets or run server
// code. Used for both properties and listings.
// Its address comes from NEXT_PUBLIC_UPLOAD_URL in web/.env.local.
const UPLOAD_URL = process.env.NEXT_PUBLIC_UPLOAD_URL;

async function uploadToIpfs(values: {
  title: string;
  description: string;
  address: string;
  amenities?: string[];
  photos: File[];
  existingImages?: string[]; // CIDs already on IPFS: referenced again, not re-uploaded
  deedNumber?: string; // registration requests only, so the verifier can check it
}): Promise<string> {
  const body = new FormData();
  body.append("title", values.title);
  if (values.deedNumber) body.append("deedNumber", values.deedNumber);
  body.append("description", values.description);
  body.append("address", values.address);
  values.amenities?.forEach((amenity) => body.append("amenities", amenity));
  values.existingImages?.forEach((cid) => body.append("existingImages", cid));
  values.photos.forEach((photo) => body.append("photos", photo));

  if (!UPLOAD_URL) {
    throw new Error("Uploads aren't set up: add NEXT_PUBLIC_UPLOAD_URL (your Worker's address) to web/.env.local.");
  }
  const res = await fetch(UPLOAD_URL, { method: "POST", body });
  const json = (await res.json()) as { metadataCID?: string; error?: string };
  if (!res.ok || !json.metadataCID) throw new Error(json.error ?? "Upload to IPFS failed");
  return json.metadataCID;
}

// A message shown at the top of the page (transaction progress, errors…)
type Notice = { kind: "info" | "pending" | "success" | "error"; text: string; hash?: Hash };

type Filter = "all" | "available" | "mine";

export default function Home() {
  // ---------------------------------------------------------------------------
  // Page state (React re-draws the page whenever these change)
  // ---------------------------------------------------------------------------
  const [account, setAccount] = useState<Address | null>(null); // connected wallet
  const [balance, setBalance] = useState<bigint | null>(null);   // its ETH balance
  const [chainId, setChainId] = useState<number | null>(null);   // network MetaMask is on
  const [listings, setListings] = useState<Listing[]>([]);       // read from the chain
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);                       // true while a tx is in progress
  // Filters: all of these are ON-CHAIN fields, which is why we can filter on them
  const [filter, setFilter] = useState<Filter>("all");
  const [typeFilter, setTypeFilter] = useState<number | "">("");
  const [categoryFilter, setCategoryFilter] = useState<number | "">("");
  const [regionFilter, setRegionFilter] = useState("");
  // Property NFTs owned by the connected wallet, and the sidebar's state
  const [properties, setProperties] = useState<OwnedProperty[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"list" | "register">("list");
  const [listPropertyId, setListPropertyId] = useState<bigint | null>(null); // chosen via "List it"
  // Escrow: this wallet's deals, the ETH it can withdraw, and the contract's settings
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pendingWithdrawal, setPendingWithdrawal] = useState(0n);
  const [confirmWindow, setConfirmWindow] = useState(7n * 24n * 60n * 60n);
  // Milestone 7: registration requests, this wallet's ROLES, and verified agents
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [roles, setRoles] = useState({ admin: false, verifier: false, arbiter: false });
  const [verifiedAgents, setVerifiedAgents] = useState<Set<string>>(new Set());
  const [badgeVersion, setBadgeVersion] = useState(0); // bumped when a badge is issued/revoked
  // Milestone 10: XMTP messaging
  // (kept together with the address it belongs to, so switching MetaMask
  //  account never shows the previous account's messages)
  const [xmtp, setXmtp] = useState<{ address: Address; client: XmtpClient } | null>(null);
  const [xmtpEnabling, setXmtpEnabling] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null);
  const [chainTime, setChainTime] = useState(0n); // latest block's timestamp

  const wrongNetwork = account !== null && chainId !== null && chainId !== chain.id;

  // Re-read the listings after a transaction changes them.
  async function loadListings() {
    setListings(await fetchListings());
  }

  // READ: an account's ETH balance is also just a free read from the chain.
  // It drops a little after every transaction you send: that's the gas fee.
  async function refreshBalance(address: Address) {
    setBalance(await publicClient.getBalance({ address }));
  }

  // Load the listings once, when the page first opens.
  useEffect(() => {
    fetchListings()
      .then(setListings)
      .catch((err) =>
        setNotice({
          kind: "error",
          text:
            err instanceof ContractNotDeployedError
              ? err.message
              : isLocal
                ? `Could not reach your local blockchain: ${errorMessage(err)}. Is \`npm run chain\` (or \`npx hardhat node\`) running?`
                : `Could not reach ${chain.name}: ${errorMessage(err)}. Check NEXT_PUBLIC_SEPOLIA_RPC_URL in web/.env.local.`,
        }),
      )
      .finally(() => setLoading(false));
  }, []);

  // ---------------------------------------------------------------------------
  // LIVE FEED: listen for the contract's EVENTS
  // ---------------------------------------------------------------------------
  // Whenever ANYONE creates, updates or changes the status of a listing, the
  // contract emits ListingCreated, ListingUpdated or ListingStatusChanged.
  // `watchContractEvent` asks the node for new event logs from this contract
  // every second, and when some arrive we re-read the listings. So every open
  // browser window updates by itself, with no refresh, even for listings
  // posted by other people.
  useEffect(() => {
    const unwatch = publicClient.watchContractEvent({
      address: LISTING_BOARD_ADDRESS,
      abi: listingBoardAbi, // the ABI tells viem how to decode the event data
      pollingInterval: POLL_MS, // how often to check for new events (lib/chain.ts)
      onLogs: (logs) => {
        // Each log is one event. viem decodes it using the ABI, e.g.
        // { eventName: "ListingCreated", args: { id: 3n, owner: "0x…", ... } }
        console.log("New contract events:", logs.map((log) => log.eventName));
        synced(latestBlock(logs)) // on Sepolia: let The Graph catch up first
          .then(fetchListings)
          .then(setListings)
          .catch(() => {});
      },
    });
    return unwatch; // stop listening when the page closes
  }, []);

  // ---------------------------------------------------------------------------
  // MY PROPERTIES: load the wallet's property NFTs, and keep them up to date
  // ---------------------------------------------------------------------------
  // The registry emits PropertyRegistered when a property is created, and the
  // standard ERC-721 Transfer event whenever an NFT changes hands. Either one
  // can change which properties this wallet owns, so we re-read on both.
  // (Milestone 7: the same events also cover registration requests, so we
  //  reload the requests list here too.)
  useEffect(() => {
    if (!account || wrongNetwork) return;
    const reload = () => {
      fetchOwnedProperties(account).then(setProperties).catch(() => {});
      fetchRequests().then(setRequests).catch(() => {});
    };
    reload();
    const unwatch = publicClient.watchContractEvent({
      address: PROPERTY_REGISTRY_ADDRESS,
      abi: propertyRegistryAbi,
      pollingInterval: POLL_MS,
      onLogs: (logs) => {
        synced(latestBlock(logs)).then(reload).catch(() => {});
      },
    });
    return unwatch;
  }, [account, wrongNetwork]);
  const myProperties = account && !wrongNetwork ? properties : [];

  // ---------------------------------------------------------------------------
  // ESCROW: read its fixed setting once (how long the buyer's confirmation
  // window lasts). It's a `constant`, so it never changes after deployment.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    publicClient
      .readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "CONFIRM_WINDOW" })
      .then(setConfirmWindow)
      .catch(() => {});
  }, []);

  // ---------------------------------------------------------------------------
  // ROLES (Milestone 7): which roles does this wallet hold?
  // ---------------------------------------------------------------------------
  // `hasRole(role, account)` is AccessControl's free check. Each role is
  // identified by a bytes32 hash, which we read from the contract first.
  // Roles can be granted or revoked at any time, so we re-check whenever a
  // RoleGranted / RoleRevoked event appears (the escrow's or the registry's).
  useEffect(() => {
    if (!account || wrongNetwork) return;
    const check = async () => {
      const [verifierRole, adminRole, arbiterRole] = await Promise.all([
        publicClient.readContract({ address: PROPERTY_REGISTRY_ADDRESS, abi: propertyRegistryAbi, functionName: "VERIFIER_ROLE" }),
        publicClient.readContract({ address: PROPERTY_REGISTRY_ADDRESS, abi: propertyRegistryAbi, functionName: "DEFAULT_ADMIN_ROLE" }),
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "ARBITER_ROLE" }),
      ]);
      const [verifier, admin, arbiter] = await Promise.all([
        publicClient.readContract({ address: PROPERTY_REGISTRY_ADDRESS, abi: propertyRegistryAbi, functionName: "hasRole", args: [verifierRole, account] }),
        publicClient.readContract({ address: PROPERTY_REGISTRY_ADDRESS, abi: propertyRegistryAbi, functionName: "hasRole", args: [adminRole, account] }),
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "hasRole", args: [arbiterRole, account] }),
      ]);
      setRoles({ verifier, admin, arbiter });
    };
    check().catch(() => {});
    // (We watch ALL of each contract's events, so RoleGranted AND RoleRevoked are both caught.)
    const unwatchRegistry = publicClient.watchContractEvent({
      address: PROPERTY_REGISTRY_ADDRESS,
      abi: propertyRegistryAbi,
      pollingInterval: POLL_MS,
      onLogs: (logs) => {
        if (logs.some((log) => log.eventName === "RoleGranted" || log.eventName === "RoleRevoked")) {
          check().catch(() => {});
        }
      },
    });
    const unwatchEscrow = publicClient.watchContractEvent({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      pollingInterval: POLL_MS,
      onLogs: (logs) => {
        if (logs.some((log) => log.eventName === "RoleGranted" || log.eventName === "RoleRevoked")) {
          check().catch(() => {});
        }
      },
    });
    return () => {
      unwatchRegistry();
      unwatchEscrow();
    };
  }, [account, wrongNetwork]);
  const myRoles = account && !wrongNetwork ? roles : { admin: false, verifier: false, arbiter: false };
  const isArbiter = myRoles.arbiter;

  // ---------------------------------------------------------------------------
  // VERIFIED AGENTS: which listers hold a soulbound AgentBadge?
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const unwatch = publicClient.watchContractEvent({
      address: AGENT_BADGE_ADDRESS,
      abi: agentBadgeAbi,
      pollingInterval: POLL_MS,
      // AgentVerified / AgentRevoked → re-check (after The Graph catches up, on Sepolia)
      onLogs: (logs) => {
        synced(latestBlock(logs))
          .then(() => setBadgeVersion((v) => v + 1))
          .catch(() => {});
      },
    });
    return unwatch;
  }, []);
  useEffect(() => {
    if (listings.length === 0) return;
    fetchVerifiedAgents(listings.map((l) => l.owner))
      .then(setVerifiedAgents)
      .catch(() => {});
  }, [listings, badgeVersion]);

  // Registration requests: the owner's own, and (for verifiers) the queue
  const myRequests = account
    ? requests.filter((r) => r.applicant.toLowerCase() === account.toLowerCase() && r.status !== RequestStatus.Approved)
    : [];
  const pendingRequests = requests.filter((r) => r.status === RequestStatus.Pending);

  // MY DEALS: load them, and re-load whenever the escrow emits any event
  // (DealOpened, DealAccepted, DealCompleted, DealRefunded, DealDisputed, Withdrawal)
  useEffect(() => {
    if (!account || wrongNetwork) return;
    const reload = () =>
      fetchDeals(account, isArbiter)
        .then(({ deals, pending, chainTime }) => {
          setDeals(deals);
          setPendingWithdrawal(pending);
          setChainTime(chainTime);
        })
        .catch(() => {});
    reload();
    const unwatch = publicClient.watchContractEvent({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      pollingInterval: POLL_MS,
      onLogs: (logs) => {
        synced(latestBlock(logs)).then(reload).catch(() => {});
      },
    });
    return unwatch;
  }, [account, wrongNetwork, isArbiter]);
  const myDeals = account && !wrongNetwork ? deals : [];
  const myPending = account && !wrongNetwork ? pendingWithdrawal : 0n;

  // ---------------------------------------------------------------------------
  // MESSAGING (Milestone 10): if this wallet already enabled XMTP in this
  // browser, reconnect silently (no signature). Otherwise wait for the user
  // to click "Enable messaging".
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    let client: XmtpClient | null = null;
    connectXmtp(account, () => Promise.reject(new Error("not now")), { allowSignature: false })
      .then((connected) => {
        client = connected;
        if (cancelled) connected?.close();
        else if (connected) setXmtp({ address: account, client: connected });
      })
      .catch(() => {}); // e.g. the browser doesn't support OPFS: messaging just stays off
    return () => {
      cancelled = true;
      client?.close(); // switching account: release this browser's XMTP database
    };
  }, [account]);
  const myXmtp = xmtp && account && xmtp.address.toLowerCase() === account.toLowerCase() ? xmtp.client : null;

  // Errors from inside the chat window. `useCallback` keeps this function the
  // SAME between renders, so the chat's live message streams aren't restarted.
  const onChatError = useCallback((message: string) => setNotice({ kind: "error", text: message }), []);

  // Follow what happens inside MetaMask.
  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;

    // `eth_accounts` (unlike `eth_requestAccounts`) never shows a popup. It
    // returns accounts that already approved this site, so a page reload
    // keeps you connected.
    ethereum.request({ method: "eth_accounts" }).then(([address]) => {
      if (address) setAccount(address);
    });
    ethereum.request({ method: "eth_chainId" }).then((id) => setChainId(Number(id)));

    const onAccountsChanged = (accounts: Address[]) => setAccount(accounts[0] ?? null);
    const onChainChanged = (id: string) => setChainId(Number(id));
    ethereum.on("accountsChanged", onAccountsChanged);
    ethereum.on("chainChanged", onChainChanged);
    return () => {
      ethereum.removeListener("accountsChanged", onAccountsChanged);
      ethereum.removeListener("chainChanged", onChainChanged);
    };
  }, []);

  // Whenever the connected account (or network) changes, re-read its balance.
  useEffect(() => {
    if (!account || wrongNetwork) return;
    publicClient
      .getBalance({ address: account })
      .then(setBalance)
      .catch(() => setBalance(null));
  }, [account, wrongNetwork]);
  const showBalance = account !== null && !wrongNetwork && balance !== null;

  // ---------------------------------------------------------------------------
  // CONNECT: ask MetaMask for permission to see the user's address
  // ---------------------------------------------------------------------------
  async function connectWallet() {
    if (!window.ethereum) {
      setNotice({ kind: "error", text: "MetaMask isn't installed. Get it from https://metamask.io" });
      return;
    }
    try {
      // Opens the MetaMask "Connect to this site?" popup.
      // The site only learns the user's PUBLIC address. MetaMask never
      // shares the private key with anyone.
      const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(address);
      await switchToAppChain();
      setNotice(null);
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    }
  }

  // Make sure MetaMask is on your local chain (31337), not e.g. BNB Chain.
  // If not, ask MetaMask to switch.
  async function switchToAppChain() {
    if (!window.ethereum) return;
    const id = await window.ethereum.request({ method: "eth_chainId" });
    if (Number(id) !== chain.id) {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: toHex(chain.id) }],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // The WALLET client is for WRITING: sending transactions.
  // Instead of a direct HTTP connection, it goes through MetaMask (`custom`),
  // so every transaction must be approved and SIGNED by the user in MetaMask.
  // ---------------------------------------------------------------------------
  function getWalletClient() {
    if (!window.ethereum || !account) throw new Error("Connect your wallet first.");
    return createWalletClient({
      account,
      chain,
      transport: custom(window.ethereum),
    });
  }

  // ---------------------------------------------------------------------------
  // REQUEST REGISTRATION (Milestone 7): the owner applies; a verifier decides.
  // The NFT (the TOKENIZATION step) is only minted when a verifier approves.
  // ---------------------------------------------------------------------------
  async function handleRegister(values: PropertyFormValues): Promise<boolean> {
    try {
      setBusy(true);

      // 1. Fingerprint the deed number. Only this hash goes on-chain.
      const hash = deedHash(values.deedNumber);

      // 2. A free READ first, to give a friendly message. (The contract would
      //    reject a duplicate anyway with DeedAlreadyRegistered, but only
      //    after the user had paid to upload the photos.)
      const taken = await publicClient.readContract({
        address: PROPERTY_REGISTRY_ADDRESS,
        abi: propertyRegistryAbi,
        functionName: "isDeedRegistered",
        args: [hash],
      });
      if (taken) {
        setNotice({
          kind: "error",
          text: `Deed ${normalizeDeedNumber(values.deedNumber)} is already registered. Each deed can only be registered once.`,
        });
        return false;
      }

      // 3. OFF-CHAIN: photos + details + the deed number → IPFS, for the verifier
      setNotice({ kind: "pending", text: `Uploading ${values.photos.length} photo(s) and documents to IPFS…` });
      const metadataCID = await uploadToIpfs({ ...values, deedNumber: normalizeDeedNumber(values.deedNumber) });

      // 4. ON-CHAIN: submit the REQUEST (no NFT yet)
      setNotice({ kind: "pending", text: "Uploaded to IPFS ✔ Now confirm the request in MetaMask…" });
      const txHash = await getWalletClient().writeContract({
        address: PROPERTY_REGISTRY_ADDRESS,
        abi: propertyRegistryAbi,
        functionName: "requestRegistration",
        args: [hash, metadataCID],
      });
      setNotice({ kind: "pending", text: "Transaction sent. Waiting for it to be mined…", hash: txHash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      // 5. Which request number did we get? It's inside the
      //    RegistrationRequested event, in the receipt's logs. `parseEventLogs`
      //    decodes the raw logs using the ABI.
      const [requested] = parseEventLogs({
        abi: propertyRegistryAbi,
        eventName: "RegistrationRequested",
        logs: receipt.logs,
      });

      // 6. On Sepolia: wait for The Graph to index this block before re-reading
      if (!isLocal) setNotice({ kind: "pending", text: "Mined ✔ Waiting for The Graph to index it…", hash: txHash });
      await synced(receipt.blockNumber);

      setNotice({
        kind: "success",
        text: `Request #${requested.args.requestId} submitted. A verifier will check your deed; once approved, the property NFT appears under My properties.`,
        hash: txHash,
      });
      setRequests(await fetchRequests());
      if (account) await refreshBalance(account);
      return true;
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // VERIFIER ACTIONS (Milestone 7). Only work for wallets with VERIFIER_ROLE:
  // anyone else gets AccessControlUnauthorizedAccount from the contract.
  // ---------------------------------------------------------------------------
  async function handleApprove(requestId: bigint) {
    await sendTx(
      `Confirm in MetaMask: approve request #${requestId} and mint the property NFT to the applicant…`,
      `Request #${requestId} approved: the property NFT was minted to the owner.`,
      () =>
        getWalletClient().writeContract({
          address: PROPERTY_REGISTRY_ADDRESS,
          abi: propertyRegistryAbi,
          functionName: "approveRegistration",
          args: [requestId],
        }),
    );
  }

  async function handleReject(requestId: bigint, reason: string) {
    await sendTx(
      `Confirm in MetaMask: reject request #${requestId}…`,
      `Request #${requestId} rejected. The reason is now public in the contract's event log.`,
      () =>
        getWalletClient().writeContract({
          address: PROPERTY_REGISTRY_ADDRESS,
          abi: propertyRegistryAbi,
          functionName: "rejectRegistration",
          args: [requestId, reason],
        }),
    );
  }

  async function handleIssueBadge(values: BadgeFormValues): Promise<boolean> {
    try {
      setBusy(true);
      // The agent's public profile goes to IPFS; only its CID goes on-chain
      setNotice({ kind: "pending", text: "Uploading the agent's profile to IPFS…" });
      const profileCID = await uploadToIpfs({
        title: values.name,
        description: [values.licence && `Licence: ${values.licence}`, values.agency && `Agency: ${values.agency}`]
          .filter(Boolean)
          .join("\n"),
        address: values.agency,
        photos: values.photos,
      });
      setBusy(false);
      return sendTx(
        "Confirm in MetaMask: issue a soulbound Verified Agent badge…",
        `Badge issued: ${shortAddress(values.agent)} is now a verified agent.`,
        () =>
          getWalletClient().writeContract({
            address: AGENT_BADGE_ADDRESS,
            abi: agentBadgeAbi,
            functionName: "issueBadge",
            args: [values.agent as Address, profileCID],
          }),
      );
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
      setBusy(false);
      return false;
    }
  }

  async function handleRevokeBadge(agent: Address): Promise<boolean> {
    return sendTx(
      `Confirm in MetaMask: revoke ${shortAddress(agent)}'s badge…`,
      `Badge revoked: ${shortAddress(agent)} is no longer a verified agent.`,
      () =>
        getWalletClient().writeContract({
          address: AGENT_BADGE_ADDRESS,
          abi: agentBadgeAbi,
          functionName: "revokeBadge",
          args: [agent],
        }),
    );
  }

  // ---------------------------------------------------------------------------
  // MESSAGING (Milestone 10)
  // ---------------------------------------------------------------------------
  // "Enable messaging": create this wallet's XMTP identity. MetaMask asks for
  // a SIGNATURE, not a transaction: free, no gas, nothing written on-chain.
  async function handleEnableMessaging() {
    if (!account) return;
    if (isPublicTestAccount(account)) {
      setNotice({
        kind: "error",
        text: `${shortAddress(account)} is one of Hardhat's PUBLIC test accounts: everyone uses it, so its XMTP inbox is already full (10/10 devices). Connect one of your own accounts (e.g. Sepolia Seller) to this site in MetaMask, then try again.`,
      });
      return;
    }
    try {
      setXmtpEnabling(true);
      const client = await connectXmtp(
        account,
        (message) => getWalletClient().signMessage({ message }), // MetaMask's "Signature request"
        { allowSignature: true },
      );
      if (client) setXmtp({ address: account, client });
    } catch (err) {
      setNotice({ kind: "error", text: `Couldn't enable messaging: ${errorMessage(err)}` });
    } finally {
      setXmtpEnabling(false);
    }
  }

  // Open a chat with someone (a listing's seller, or the other side of a deal)
  async function startChat(target: ChatTarget) {
    // Only people who have enabled XMTP can receive messages
    if (myXmtp && !(await canMessage(myXmtp, target.address).catch(() => true))) {
      setNotice({
        kind: "error",
        text: `${shortAddress(target.address)} hasn't enabled messaging on LinXar yet, so they can't receive messages. Ask them to click "Messages" → "Enable messaging" once.`,
      });
      return;
    }
    setChatTarget(target);
    setChatOpen(true);
  }

  // "List it" on one of My properties
  function startListing(propertyId: bigint) {
    setListPropertyId(propertyId);
    setSidebarTab("list");
  }

  // ---------------------------------------------------------------------------
  // CREATE A LISTING: first IPFS (off-chain), then one transaction (on-chain)
  // ---------------------------------------------------------------------------
  async function handleCreate(values: ListingFormValues): Promise<boolean> {
    const propertyId = values.propertyId;
    if (propertyId === null) return false;
    try {
      setBusy(true);

      // 1. OFF-CHAIN: details (+ any extra photos) → IPFS. The property's own
      //    photos are already on IPFS, so they're included by CID only.
      //    We get back one CID, a short fingerprint of the whole bundle.
      setNotice({
        kind: "pending",
        text:
          values.photos.length > 0
            ? `Uploading ${values.photos.length} extra photo(s) and the listing details to IPFS…`
            : "Saving the listing details to IPFS (reusing your property's photos)…",
      });
      const metadataCID = await uploadToIpfs(values);

      // 2. SEND: viem encodes the call using the ABI and hands it to MetaMask.
      //    MetaMask shows the popup with the GAS FEE. When the user confirms,
      //    MetaMask signs it with the private key and broadcasts it.
      //    We get back the transaction HASH: its unique ID / receipt number.
      setNotice({ kind: "pending", text: "Uploaded to IPFS ✔ Now confirm the transaction in MetaMask…" });
      const hash = await getWalletClient().writeContract({
        address: LISTING_BOARD_ADDRESS,
        abi: listingBoardAbi,
        functionName: "createListing",
        // The contract takes ONE struct (NewListing). viem builds it from this
        // object, matching keys to the struct's field names via the ABI.
        args: [
          {
            // The contract asks the registry: does msg.sender own this NFT
            // (or are they an approved agent)? If not: NotAuthorizedForProperty.
            propertyId,
            listingType: values.listingType,
            category: values.category,
            pricePeriod: values.pricePeriod,
            priceWei: parseEther(values.price), // "2.5" ETH → 2500000000000000000n wei
            sizeSqm: Math.round(Number(values.sizeSqm || 0)),
            region: values.region,
            metadataCID, // the IPFS fingerprint goes on-chain
          },
        ],
      });

      // 3. WAIT: the transaction is "pending" until a block includes it.
      //    On your local node that's almost instant; on Sepolia ~12 seconds.
      setNotice({ kind: "pending", text: "Transaction sent. Waiting for it to be mined…", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      // On Sepolia: wait for The Graph to index this block, so the new
      // listing shows up as soon as we re-read
      if (!isLocal) setNotice({ kind: "pending", text: "Mined ✔ Waiting for The Graph to index it…", hash });
      await synced(receipt.blockNumber);

      // 4. DONE: the listing is now permanently on the blockchain, pointing to
      //    its photos and details on IPFS.
      setNotice({ kind: "success", text: "Listing created: photos on IPFS, record on the blockchain.", hash });
      await Promise.all([loadListings(), account && refreshBalance(account)]);
      return true;
    } catch (err) {
      // e.g. the upload failed, or the user clicked "Reject" in MetaMask
      setNotice({ kind: "error", text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // A helper for one transaction: MetaMask → mined → done, with progress shown
  // in the notice bar. Returns true if it succeeded.
  // ---------------------------------------------------------------------------
  async function sendTx(confirmText: string, successText: string, send: () => Promise<Hash>): Promise<boolean> {
    try {
      setBusy(true);
      setNotice({ kind: "pending", text: confirmText });
      const hash = await send();
      setNotice({ kind: "pending", text: "Transaction sent. Waiting for it to be mined…", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") throw new Error("The transaction was reverted by the contract.");
      // On Sepolia: don't announce success until The Graph has indexed it,
      // so the panels already show the new state when the message appears
      if (!isLocal) setNotice({ kind: "pending", text: "Mined ✔ Waiting for The Graph to index it…", hash });
      await synced(receipt.blockNumber);
      setNotice({ kind: "success", text: successText, hash });
      if (account) await refreshBalance(account);
      return true;
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // ESCROW 1: MAKE AN OFFER, which locks the buyer's ETH in the contract
  // ---------------------------------------------------------------------------
  // `value` attaches ETH to the transaction. Inside the contract it arrives
  // as msg.value, in the `payable` openDeal function. The money goes to the
  // ESCROW's balance, not to the seller.
  async function handleMakeOffer(listing: Listing, amountWei: bigint): Promise<boolean> {
    return sendTx(
      `Confirm in MetaMask: lock ${formatEther(amountWei)} ETH in the escrow contract…`,
      `Offer made: ${formatEther(amountWei)} ETH is locked in the escrow. It appears under "My deals".`,
      () =>
        getWalletClient().writeContract({
          address: ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName: "openDeal",
          args: [listing.id],
          value: amountWei,
        }),
    );
  }

  // ---------------------------------------------------------------------------
  // ESCROW 2: THE DEAL BUTTONS. Each one calls one escrow function.
  // ---------------------------------------------------------------------------
  function escrowCall(action: DealAction, dealId: bigint): Promise<Hash> {
    const wallet = getWalletClient();
    const base = { address: ESCROW_ADDRESS, abi: escrowAbi } as const;
    switch (action) {
      case "cancel": return wallet.writeContract({ ...base, functionName: "cancelDeal", args: [dealId] });
      case "reject": return wallet.writeContract({ ...base, functionName: "rejectDeal", args: [dealId] });
      case "accept": return wallet.writeContract({ ...base, functionName: "acceptDeal", args: [dealId] });
      case "confirm": return wallet.writeContract({ ...base, functionName: "confirmDeal", args: [dealId] });
      case "finalize": return wallet.writeContract({ ...base, functionName: "finalizeAfterTimeout", args: [dealId] });
      case "dispute": return wallet.writeContract({ ...base, functionName: "raiseDispute", args: [dealId] });
      case "refund": return wallet.writeContract({ ...base, functionName: "resolveDispute", args: [dealId, false] });
      case "release": return wallet.writeContract({ ...base, functionName: "resolveDispute", args: [dealId, true] });
    }
  }

  const ACTION_TEXT: Record<DealAction, string> = {
    cancel: "Deal cancelled. Your money is waiting for you to withdraw it.",
    reject: "Offer rejected. The buyer has been refunded.",
    accept: "Offer accepted. The buyer now has 7 days to confirm or dispute.",
    confirm: "Deal completed! The seller has been paid.",
    finalize: "Deal finalised after the buyer's window ran out.",
    dispute: "Dispute raised. The arbiter will decide.",
    refund: "Dispute resolved: the buyer has been refunded.",
    release: "Dispute resolved: the seller has been paid.",
  };

  async function handleDealAction(deal: Deal, action: DealAction) {
    // Accepting a SALE needs one extra step first: the seller must allow the
    // escrow contract to move their property NFT (the standard ERC-721
    // "approval"). Otherwise the escrow couldn't hand the property to the
    // buyer later, and the contract refuses the acceptance.
    if (action === "accept" && deal.kind === DealKind.Purchase && account) {
      const approved = await publicClient.readContract({
        address: PROPERTY_REGISTRY_ADDRESS,
        abi: propertyRegistryAbi,
        functionName: "isApprovedForAll",
        args: [account, ESCROW_ADDRESS],
      });
      if (!approved) {
        const ok = await sendTx(
          "Step 1 of 2: confirm in MetaMask to let the escrow transfer your property NFT when the sale completes…",
          "Escrow approved to transfer your property NFTs.",
          () =>
            getWalletClient().writeContract({
              address: PROPERTY_REGISTRY_ADDRESS,
              abi: propertyRegistryAbi,
              functionName: "setApprovalForAll",
              args: [ESCROW_ADDRESS, true],
            }),
        );
        if (!ok) return;
      }
    }

    const completesSale = deal.kind === DealKind.Purchase && (action === "confirm" || action === "finalize" || action === "release");
    await sendTx(
      action === "accept" && deal.kind === DealKind.Purchase
        ? "Step 2 of 2: confirm in MetaMask to accept the offer…"
        : "Confirm in MetaMask…",
      completesSale
        ? "Sale completed! In ONE transaction, the seller was paid and the property NFT moved to the buyer."
        : ACTION_TEXT[action],
      () => escrowCall(action, deal.id),
    );
  }

  // ---------------------------------------------------------------------------
  // ESCROW 3: WITHDRAW. Pull payments: the ETH only leaves the contract now.
  // ---------------------------------------------------------------------------
  async function handleWithdraw() {
    await sendTx(
      `Confirm in MetaMask: withdraw ${formatEther(myPending)} ETH from the escrow…`,
      `${formatEther(myPending)} ETH withdrawn to your wallet.`,
      () => getWalletClient().writeContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "withdraw" }),
    );
  }

  // ---------------------------------------------------------------------------
  // CHANGE STATUS: Available / Under offer / Rented / Sold / Withdrawn
  // ---------------------------------------------------------------------------
  // Only the owner can do this. The contract's `onlyListingOwner` modifier
  // would reject anyone else with the NotListingOwner error.
  async function handleSetStatus(id: bigint, status: number) {
    try {
      setBusy(true);
      setNotice({ kind: "pending", text: `Confirm in MetaMask: mark listing #${id} as "${STATUSES[status]}"…` });
      const hash = await getWalletClient().writeContract({
        address: LISTING_BOARD_ADDRESS,
        abi: listingBoardAbi,
        functionName: "setStatus",
        args: [id, status], // enums are sent as their number, e.g. Sold = 3
      });
      setNotice({ kind: "pending", text: "Transaction sent. Waiting for it to be mined…", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!isLocal) setNotice({ kind: "pending", text: "Mined ✔ Waiting for The Graph to index it…", hash });
      await synced(receipt.blockNumber);
      setNotice({ kind: "success", text: `Listing #${id} is now "${STATUSES[status]}".`, hash });
      await Promise.all([loadListings(), account && refreshBalance(account)]);
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Filtering happens in the browser, on the on-chain fields already read.
  // (Milestone 9 moves this to The Graph, which reads the same fields from events.)
  // ---------------------------------------------------------------------------
  const isMine = (listing: Listing) =>
    account !== null && listing.owner.toLowerCase() === account.toLowerCase();

  const visible = listings.filter((listing) => {
    if (filter === "available" && listing.status !== Status.Available) return false;
    if (filter === "mine" && !isMine(listing)) return false;
    if (typeFilter !== "" && listing.listingType !== typeFilter) return false;
    if (categoryFilter !== "" && listing.category !== categoryFilter) return false;
    if (regionFilter && listing.region !== regionFilter) return false;
    return true;
  });

  const availableCount = listings.filter((l) => l.status === Status.Available).length;
  const mineCount = listings.filter(isMine).length;
  const filtersActive = typeFilter !== "" || categoryFilter !== "" || regionFilter !== "";

  // ---------------------------------------------------------------------------
  // What the user sees
  // ---------------------------------------------------------------------------
  return (
    <div className="flex min-h-full flex-col">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-line bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-lg font-bold tracking-tight">
              LinXar <span className="font-medium text-muted">Listings</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* The connected wallet's on-chain roles (Milestone 7) */}
            {myRoles.admin && <RoleChip label="Admin" />}
            {myRoles.verifier && <RoleChip label="Verifier" />}
            {myRoles.arbiter && <RoleChip label="Arbiter" />}
            {/* Milestone 10: open the XMTP messaging window */}
            {account && (
              <button
                onClick={() => {
                  setChatTarget(null);
                  setChatOpen((open) => !open);
                }}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold hover:border-brand"
              >
                💬 Messages
              </button>
            )}
            <NetworkBadge account={account} wrongNetwork={wrongNetwork} onSwitch={switchToAppChain} />
            {account ? (
              <div className="flex items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-3 pr-1.5 text-sm">
                {showBalance && (
                  <span className="hidden font-medium sm:inline">
                    {Number(formatEther(balance)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH
                  </span>
                )}
                <span className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-xs">
                  {shortAddress(account)}
                </span>
              </div>
            ) : (
              <button
                onClick={connectWallet}
                className="flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong"
              >
                <WalletIcon /> Connect wallet
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 py-8 sm:px-6">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-3xl bg-brand px-6 py-10 text-on-brand sm:px-10">
          <p className="text-sm font-medium uppercase tracking-widest opacity-80">Ghana · on Ethereum</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">
            Property listings you can verify, not just trust.
          </h1>
          <p className="mt-3 max-w-xl opacity-85">
            Every listing lives on the blockchain, with its photos on IPFS. Nobody can secretly edit it or fake who
            posted it, including us.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Stat label="Listings" value={listings.length} />
            <Stat label="Available" value={availableCount} />
            {account && <Stat label="Yours" value={mineCount} />}
          </div>
        </section>

        {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}

        {/* ── My properties (the wallet's NFTs) ─────────────────────────── */}
        {/* ── Verifier dashboard: only for wallets with VERIFIER_ROLE ──── */}
        {myRoles.verifier && (
          <VerifierPanel
            pendingRequests={pendingRequests}
            busy={busy}
            onApprove={handleApprove}
            onReject={handleReject}
            onIssueBadge={handleIssueBadge}
            onRevokeBadge={handleRevokeBadge}
          />
        )}

        {/* ── My registration requests (pending / rejected) ─────────────── */}
        <MyRequests requests={myRequests} loadRejectionReason={fetchRejectionReason} />

        <MyProperties properties={myProperties} onList={startListing} />

        {/* ── My deals (escrow) ─────────────────────────────────────────── */}
        {account && (
          <DealsPanel
            deals={myDeals}
            listings={listings}
            account={account}
            isArbiter={isArbiter}
            confirmWindowSeconds={confirmWindow}
            chainTime={chainTime}
            pendingWithdrawal={myPending}
            busy={busy}
            onAction={handleDealAction}
            onWithdraw={handleWithdraw}
            onMessage={(address) => startChat({ address })}
          />
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          {/* ── Listings ────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-xl border border-line bg-surface p-1 text-sm">
                {(["all", "available", "mine"] as const).map((f) =>
                  f === "mine" && !account ? null : (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`rounded-lg px-3 py-1.5 font-medium capitalize ${
                        filter === f ? "bg-brand text-on-brand" : "text-muted hover:text-foreground"
                      }`}
                    >
                      {f === "mine" ? "My listings" : f}
                    </button>
                  ),
                )}
              </div>

              <FilterSelect
                value={typeFilter}
                onChange={(v) => setTypeFilter(v === "" ? "" : Number(v))}
                placeholder="Any type"
                options={LISTING_TYPES.map((label, value) => ({ label, value }))}
              />
              <FilterSelect
                value={categoryFilter}
                onChange={(v) => setCategoryFilter(v === "" ? "" : Number(v))}
                placeholder="Any category"
                options={CATEGORIES.map((label, value) => ({ label, value }))}
              />
              <FilterSelect
                value={regionFilter}
                onChange={setRegionFilter}
                placeholder="Any region"
                options={REGIONS.map((region) => ({ label: region, value: region }))}
              />
              {filtersActive && (
                <button
                  onClick={() => {
                    setTypeFilter("");
                    setCategoryFilter("");
                    setRegionFilter("");
                  }}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Clear
                </button>
              )}
            </div>

            {loading ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <ListingCardSkeleton />
                <ListingCardSkeleton />
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
                <HouseIcon className="h-10 w-10 text-muted" />
                <p className="mt-3 font-semibold">
                  {listings.length === 0 ? "No listings yet" : "Nothing matches these filters"}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {listings.length === 0
                    ? account
                      ? "Post the first one using the form."
                      : "Connect your wallet to post the first one."
                    : "Try a different type, category or region."}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {visible.map((listing) => (
                  <ListingCard
                    key={listing.id.toString()}
                    listing={listing}
                    isMine={isMine(listing)}
                    busy={busy}
                    canOffer={account !== null && !wrongNetwork && !isMine(listing) && listing.status === Status.Available}
                    verifiedAgent={verifiedAgents.has(listing.owner.toLowerCase())}
                    onSetStatus={handleSetStatus}
                    onMakeOffer={handleMakeOffer}
                    onMessage={
                      account
                        ? (l, title) => startChat({ address: l.owner, listingId: l.id, listingTitle: title })
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── Sidebar: list a property / register a property ──────────── */}
          <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
              {/* Two steps, two contracts: register (PropertyRegistry) → list (ListingBoard) */}
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 text-sm">
                {(
                  [
                    ["list", "List a property"],
                    ["register", "Register property"], // now submits a request for verification
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    onClick={() => setSidebarTab(tab)}
                    className={`rounded-lg py-2 font-semibold ${
                      sidebarTab === tab ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* The forms are only usable once a wallet is connected,
                  because both actions need a signed transaction */}
              {!account ? (
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-muted">
                    Registering and listing are blockchain transactions, so you need a wallet to sign them.
                  </p>
                  <button
                    onClick={connectWallet}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-strong"
                  >
                    <WalletIcon /> Connect wallet
                  </button>
                </div>
              ) : sidebarTab === "register" ? (
                <RegisterPropertyForm busy={busy} disabled={wrongNetwork} onSubmit={handleRegister} />
              ) : (
                <CreateListingForm
                  // A new key when the chosen property changes resets the form to it
                  key={`${listPropertyId ?? "none"}-${myProperties.length}`}
                  properties={myProperties}
                  initialPropertyId={listPropertyId}
                  busy={busy}
                  disabled={wrongNetwork}
                  onRegisterFirst={() => setSidebarTab("register")}
                  onSubmit={handleCreate}
                />
              )}
            </div>
          </aside>
        </div>
      </main>

      {/* ── Messaging window (XMTP, Milestone 10) ───────────────────────── */}
      {chatOpen && account && (
        <ChatPanel
          client={myXmtp}
          enabling={xmtpEnabling}
          target={chatTarget}
          onEnable={handleEnableMessaging}
          onClose={() => setChatOpen(false)}
          onError={onChatError}
        />
      )}

      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        Contract{" "}
        {explorerAddressUrl(LISTING_BOARD_ADDRESS) ? (
          // On Sepolia: a link to the contract on Etherscan, where anyone can
          // read its verified source code and every transaction it received
          <a
            href={explorerAddressUrl(LISTING_BOARD_ADDRESS)!}
            target="_blank"
            rel="noreferrer"
            className="font-mono underline"
          >
            {shortAddress(LISTING_BOARD_ADDRESS)}
          </a>
        ) : (
          <span className="font-mono">{shortAddress(LISTING_BOARD_ADDRESS)}</span>
        )}{" "}
        on {chain.name} (chain {chain.id}) · Test network: this ETH has no real value
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small presentational pieces
// ─────────────────────────────────────────────────────────────────────────────

function RoleChip({ label }: { label: string }) {
  return (
    <span
      className="hidden rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand sm:inline"
      title={`This wallet holds the ${label} role on-chain`}
    >
      {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/10 px-4 py-2.5">
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-xs opacity-80">{label}</div>
    </div>
  );
}

function FilterSelect<T extends string | number>({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: T | "";
  onChange: (value: string) => void;
  placeholder: string;
  options: { label: string; value: T }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-line bg-surface px-3 py-2 text-sm"
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.label} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function NetworkBadge({
  account,
  wrongNetwork,
  onSwitch,
}: {
  account: Address | null;
  wrongNetwork: boolean;
  onSwitch: () => void;
}) {
  if (wrongNetwork) {
    return (
      <button
        onClick={onSwitch}
        className="flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1.5 text-xs font-semibold text-danger"
      >
        <AlertIcon className="h-3.5 w-3.5" /> Wrong network · switch
      </button>
    );
  }
  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium sm:flex">
      <span className={`h-2 w-2 rounded-full ${account ? "bg-success" : "bg-muted"}`} />
      {chain.name}
    </span>
  );
}

function NoticeBanner({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const styles = {
    info: "border-line bg-surface",
    pending: "border-line bg-surface",
    success: "border-success/30 bg-success-soft text-success",
    error: "border-danger/30 bg-danger-soft text-danger",
  }[notice.kind];

  const icon = {
    info: <InfoIcon className="h-5 w-5" />,
    pending: <Spinner className="h-5 w-5" />,
    success: <CheckIcon className="h-5 w-5" />,
    error: <AlertIcon className="h-5 w-5" />,
  }[notice.kind];

  return (
    <div role="status" className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${styles}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1">
        <p className="font-medium">{notice.text}</p>
        {/* The transaction hash is the transaction's permanent ID on the chain */}
        {notice.hash && (
          <p className="mt-0.5 font-mono text-xs opacity-75">
            Tx{" "}
            {explorerTxUrl(notice.hash) ? (
              // On Sepolia: open the transaction on Etherscan
              <a href={explorerTxUrl(notice.hash)!} target="_blank" rel="noreferrer" className="underline">
                {shortAddress(notice.hash)} ↗
              </a>
            ) : (
              shortAddress(notice.hash)
            )}
          </p>
        )}
      </div>
      {notice.kind !== "pending" && (
        <button onClick={onClose} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100">
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
