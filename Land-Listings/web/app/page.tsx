// "use client" makes this page run in the user's BROWSER, not on a server.
// It has to: MetaMask lives in the browser, and in a dApp the browser talks
// directly to the blockchain. There is no backend server in between.
"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEther,
  formatEther,
  toHex,
  BaseError,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";
// `hardhat` describes your local chain: chain ID 31337, RPC http://127.0.0.1:8545
import { hardhat } from "viem/chains";
import { LISTING_BOARD_ADDRESS, listingBoardAbi } from "../lib/listingBoard";
import { ListingCard, ListingCardSkeleton, shortAddress, type Listing } from "../components/ListingCard";
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  HouseIcon,
  InfoIcon,
  LogoMark,
  SearchIcon,
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

// -----------------------------------------------------------------------------
// The PUBLIC client is for READING from the blockchain.
// It connects straight to your Hardhat node over HTTP. It needs no wallet,
// because reading is free and anyone can do it. No signature, no gas.
// -----------------------------------------------------------------------------
const publicClient = createPublicClient({ chain: hardhat, transport: http() });

// Turns any error into a short, readable message for the user.
// viem's errors have a `shortMessage`, e.g. "User rejected the request."
// or the contract's revert reason, e.g. "Not your listing".
function errorMessage(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage;
  if (err instanceof Error) return err.message;
  return String(err);
}

class ContractNotDeployedError extends Error {
  constructor() {
    super(
      "ListingBoard isn't deployed on your local chain. In the contracts folder, run `npm run deploy:local`, then refresh this page.",
    );
  }
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

  const total = await publicClient.readContract({
    address: LISTING_BOARD_ADDRESS, // WHERE the contract is
    abi: listingBoardAbi,           // WHAT functions it has
    functionName: "totalListings",  // WHICH function to call
  });

  // Fetch listings one at a time, by id: 0, 1, 2, ...
  // (Fine for a handful. In Milestone 9, The Graph replaces this loop.)
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

// A message shown at the top of the page (transaction progress, errors…)
type Status = { kind: "info" | "pending" | "success" | "error"; text: string; hash?: Hash };

type Filter = "all" | "active" | "mine";

export default function Home() {
  // ---------------------------------------------------------------------------
  // Page state (React re-draws the page whenever these change)
  // ---------------------------------------------------------------------------
  const [account, setAccount] = useState<Address | null>(null); // connected wallet
  const [balance, setBalance] = useState<bigint | null>(null);   // its ETH balance
  const [chainId, setChainId] = useState<number | null>(null);   // network MetaMask is on
  const [listings, setListings] = useState<Listing[]>([]);       // read from the chain
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");                        // form fields
  const [location, setLocation] = useState("");
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);                       // true while a tx is in progress
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const wrongNetwork = account !== null && chainId !== null && chainId !== hardhat.id;

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
        setStatus({
          kind: "error",
          text:
            err instanceof ContractNotDeployedError
              ? err.message
              : `Could not reach your local blockchain: ${errorMessage(err)}. Is \`npm run chain\` (or \`npx hardhat node\`) running?`,
        }),
      )
      .finally(() => setLoading(false));
  }, []);

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
      setStatus({ kind: "error", text: "MetaMask isn't installed. Get it from https://metamask.io" });
      return;
    }
    try {
      // Opens the MetaMask "Connect to this site?" popup.
      // The site only learns the user's PUBLIC address. MetaMask never
      // shares the private key with anyone.
      const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(address);
      await switchToLocalChain();
      setStatus(null);
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err) });
    }
  }

  // Make sure MetaMask is on your local chain (31337), not e.g. BNB Chain.
  // If not, ask MetaMask to switch.
  async function switchToLocalChain() {
    if (!window.ethereum) return;
    const id = await window.ethereum.request({ method: "eth_chainId" });
    if (Number(id) !== hardhat.id) {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: toHex(hardhat.id) }],
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
      chain: hardhat,
      transport: custom(window.ethereum),
    });
  }

  // ---------------------------------------------------------------------------
  // WRITE: create a listing. This is a real transaction.
  // ---------------------------------------------------------------------------
  async function handleCreate(event: FormEvent) {
    event.preventDefault(); // stop the browser reloading the page on submit
    try {
      setBusy(true);
      setStatus({ kind: "pending", text: "Confirm the transaction in MetaMask…" });

      // 1. SEND: viem encodes the call using the ABI and hands it to MetaMask.
      //    MetaMask shows the popup with the GAS FEE. When the user confirms,
      //    MetaMask signs it with the private key and broadcasts it.
      //    We get back the transaction HASH: its unique ID / receipt number.
      const hash = await getWalletClient().writeContract({
        address: LISTING_BOARD_ADDRESS,
        abi: listingBoardAbi,
        functionName: "createListing",
        // parseEther("2") → 2000000000000000000n (wei), just like in the tests
        args: [title, location, parseEther(price)],
      });

      // 2. WAIT: the transaction is "pending" until a block includes it.
      //    On your local node that's almost instant; on Sepolia ~12 seconds.
      setStatus({ kind: "pending", text: "Transaction sent. Waiting for it to be mined…", hash });
      await publicClient.waitForTransactionReceipt({ hash });

      // 3. DONE: the listing is now permanently stored on the blockchain.
      setStatus({ kind: "success", text: "Listing created and stored on the blockchain.", hash });
      setTitle("");
      setLocation("");
      setPrice("");
      await Promise.all([loadListings(), account && refreshBalance(account)]);
    } catch (err) {
      // e.g. the user clicked "Reject" in MetaMask
      setStatus({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // WRITE: deactivate a listing (only works if you're its owner)
  // ---------------------------------------------------------------------------
  async function handleDeactivate(id: bigint) {
    try {
      setBusy(true);
      setStatus({ kind: "pending", text: "Confirm in MetaMask…" });
      const hash = await getWalletClient().writeContract({
        address: LISTING_BOARD_ADDRESS,
        abi: listingBoardAbi,
        functionName: "deactivateListing",
        args: [id],
      });
      setStatus({ kind: "pending", text: "Transaction sent. Waiting for it to be mined…", hash });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus({ kind: "success", text: `Listing #${id} deactivated.`, hash });
      await Promise.all([loadListings(), account && refreshBalance(account)]);
    } catch (err) {
      // If the contract's `require` fails, the reason shows here:
      // "Not your listing"
      setStatus({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Filtering and search happen in the browser, on data already read.
  // ---------------------------------------------------------------------------
  const isMine = (listing: Listing) =>
    account !== null && listing.owner.toLowerCase() === account.toLowerCase();

  const q = query.trim().toLowerCase();
  const visible = listings.filter((listing) => {
    if (filter === "active" && !listing.active) return false;
    if (filter === "mine" && !isMine(listing)) return false;
    if (!q) return true;
    return listing.title.toLowerCase().includes(q) || listing.location.toLowerCase().includes(q);
  });

  const activeCount = listings.filter((l) => l.active).length;
  const mineCount = listings.filter(isMine).length;

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
            <NetworkBadge account={account} wrongNetwork={wrongNetwork} onSwitch={switchToLocalChain} />
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
            Every listing lives on the blockchain. Nobody can secretly edit it or fake who posted it,
            including us.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Stat label="Listings" value={listings.length} />
            <Stat label="Available" value={activeCount} />
            {account && <Stat label="Yours" value={mineCount} />}
          </div>
        </section>

        {status && <StatusBanner status={status} onClose={() => setStatus(null)} />}

        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
          {/* ── Listings ────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-1 rounded-xl border border-line bg-surface p-1 text-sm">
                {(["all", "active", "mine"] as const).map((f) =>
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
              <label className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm sm:w-64">
                <SearchIcon className="h-4 w-4 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search title or location"
                  className="w-full bg-transparent outline-none placeholder:text-muted"
                />
              </label>
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
                  {listings.length === 0 ? "No listings yet" : "Nothing matches your search"}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {listings.length === 0
                    ? account
                      ? "Post the first one using the form."
                      : "Connect your wallet to post the first one."
                    : "Try a different filter or search term."}
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
                    onDeactivate={handleDeactivate}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── Post a listing ──────────────────────────────────────────── */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Post a listing</h2>

              {/* The form is only usable once a wallet is connected,
                  because creating a listing needs a signed transaction */}
              {!account ? (
                <div className="mt-3 space-y-4">
                  <p className="text-sm text-muted">
                    Posting a listing is a blockchain transaction, so you need a wallet to sign it.
                  </p>
                  <button
                    onClick={connectWallet}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-strong"
                  >
                    <WalletIcon /> Connect wallet
                  </button>
                </div>
              ) : (
                <form onSubmit={handleCreate} className="mt-4 space-y-4">
                  <Field label="Title">
                    <input
                      className="input"
                      placeholder="3-bedroom house"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Location">
                    <input
                      className="input"
                      placeholder="East Legon, Accra"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Price (ETH)">
                    <input
                      className="input"
                      placeholder="2.5"
                      type="number"
                      step="any"
                      min="0"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      required
                    />
                  </Field>

                  <button
                    type="submit"
                    disabled={busy || wrongNetwork}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy && <Spinner />}
                    {busy ? "Working…" : "Create listing"}
                  </button>

                  <p className="flex gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted">
                    <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    MetaMask will ask you to confirm and pay a small gas fee. Once mined, the listing is
                    stored on the blockchain permanently.
                  </p>
                </form>
              )}
            </div>
          </aside>
        </div>
      </main>

      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        Contract{" "}
        <span className="font-mono">{shortAddress(LISTING_BOARD_ADDRESS)}</span> on Hardhat Local (chain{" "}
        {hardhat.id}) · Test network: this ETH has no real value
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small presentational pieces
// ─────────────────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/10 px-4 py-2.5">
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-xs opacity-80">{label}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
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
      Hardhat Local
    </span>
  );
}

function StatusBanner({ status, onClose }: { status: Status; onClose: () => void }) {
  const styles = {
    info: "border-line bg-surface",
    pending: "border-line bg-surface",
    success: "border-success/30 bg-success-soft text-success",
    error: "border-danger/30 bg-danger-soft text-danger",
  }[status.kind];

  const icon = {
    info: <InfoIcon className="h-5 w-5" />,
    pending: <Spinner className="h-5 w-5" />,
    success: <CheckIcon className="h-5 w-5" />,
    error: <AlertIcon className="h-5 w-5" />,
  }[status.kind];

  return (
    <div role="status" className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${styles}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1">
        <p className="font-medium">{status.text}</p>
        {/* The transaction hash is the transaction's permanent ID on the chain */}
        {status.hash && <p className="mt-0.5 font-mono text-xs opacity-75">Tx {shortAddress(status.hash)}</p>}
      </div>
      {status.kind !== "pending" && (
        <button onClick={onClose} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100">
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
