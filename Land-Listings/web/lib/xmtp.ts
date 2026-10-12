// =============================================================================
// XMTP: wallet-to-wallet messaging (Milestone 10)
// =============================================================================
// Chat can't go on Ethereum: everything there is public and permanent, and
// every message would cost gas. XMTP is a separate, decentralised messaging
// network where your WALLET ADDRESS is your identity, and every message is
// END-TO-END ENCRYPTED: only the sender and the recipient can read it, not
// XMTP and not LinXar. No LinXar server is involved.
//
// The SDK runs a WebAssembly engine in a background worker and keeps an
// encrypted local database in the browser (OPFS). So it must only ever load
// in the browser, which is why every function here imports it with
// `await import(…)` instead of a normal import at the top of the file.
//
// ⚠️ The local database supports ONE tab at a time: don't open LinXar in two
// tabs of the same browser while messaging is enabled.
// =============================================================================

import { toBytes, type Address, type Hex } from "viem";
import type { Client, DecodedMessage, Dm, Signer } from "@xmtp/browser-sdk";

// XMTP's test network (like Sepolia is Ethereum's). "production" is the real one.
export const XMTP_ENV = "dev" as const;

// Which XMTP network to use. (The SDK's type for this options object drops the
// `env` field because of how TypeScript's `Omit` handles unions, so we build
// it here and cast it to what the functions expect.)
type CreateOptions = Parameters<typeof Client.create>[1];
const CLIENT_OPTIONS = { env: XMTP_ENV, appVersion: "linxar/1.0" } as unknown as CreateOptions;

export type XmtpClient = Client<string>;
export type XmtpDm = Dm<string>;
export type XmtpMessage = DecodedMessage<string>;

// Hardhat's built-in test accounts #0–#5. Their keys are PUBLIC, so developers
// everywhere use these same addresses, and on XMTP's network their inboxes
// already hit the 10-installation limit. Use your own accounts for messaging.
const PUBLIC_TEST_ACCOUNTS = new Set(
  [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  ].map((a) => a.toLowerCase()),
);

export function isPublicTestAccount(address: Address): boolean {
  return PUBLIC_TEST_ACCOUNTS.has(address.toLowerCase());
}

// -----------------------------------------------------------------------------
// CONNECT: reuse this browser's existing XMTP identity if there is one (no
// popup), otherwise create one, which needs ONE signature from MetaMask.
// A signature proves you own the address but costs no gas and changes
// nothing on any blockchain.
// -----------------------------------------------------------------------------
export async function connectXmtp(
  address: Address,
  signMessage: (message: string) => Promise<Hex>,
  { allowSignature }: { allowSignature: boolean },
): Promise<XmtpClient | null> {
  const { Client, IdentifierKind } = await import("@xmtp/browser-sdk");
  const identifier = { identifier: address.toLowerCase(), identifierKind: IdentifierKind.Ethereum };

  // 1. Try the identity already saved in this browser
  const existing = await Client.build(identifier, CLIENT_OPTIONS);
  if (await existing.isRegistered()) return existing as unknown as XmtpClient;
  existing.close();
  if (!allowSignature) return null; // the user hasn't clicked "Enable messaging" yet

  // 2. Create a new identity. The SIGNER tells XMTP who we are (getIdentifier)
  //    and lets it ask MetaMask to sign (signMessage). XMTP turns that
  //    signature into encryption keys for this browser.
  const signer: Signer = {
    type: "EOA", // an ordinary wallet ("Externally Owned Account"), like MetaMask's
    getIdentifier: () => identifier,
    signMessage: async (message: string) => toBytes(await signMessage(message)),
  };
  const client = await Client.create(signer, CLIENT_OPTIONS);
  return client as unknown as XmtpClient;
}

// Can this address receive XMTP messages? (They must have enabled messaging once.)
export async function canMessage(client: XmtpClient, address: Address): Promise<boolean> {
  const { IdentifierKind } = await import("@xmtp/browser-sdk");
  const result = await client.canMessage([{ identifier: address.toLowerCase(), identifierKind: IdentifierKind.Ethereum }]);
  return result.get(address.toLowerCase()) ?? false;
}

// Open (or reuse) the one-to-one conversation ("DM") with an address
export async function openDm(client: XmtpClient, address: Address): Promise<XmtpDm> {
  const { IdentifierKind } = await import("@xmtp/browser-sdk");
  return client.conversations.createDmWithIdentifier({
    identifier: address.toLowerCase(),
    identifierKind: IdentifierKind.Ethereum,
  }) as Promise<XmtpDm>;
}

// XMTP identifies people by an INBOX ID, not an address. This looks up the
// wallet address behind an inbox (cached: it never changes for an inbox).
const addressCache = new Map<string, Address>();
export async function addressOfInbox(client: XmtpClient, inboxId: string): Promise<Address | null> {
  const cached = addressCache.get(inboxId);
  if (cached) return cached;
  const [state] = await client.preferences.getInboxStates([inboxId]);
  const address = state?.accountIdentifiers[0]?.identifier as Address | undefined;
  if (address) addressCache.set(inboxId, address);
  return address ?? null;
}

// =============================================================================
// VISIT REQUESTS: the brief's "appointment scheduling"
// =============================================================================
// Sent as ordinary text messages with a small JSON payload after a marker, so
// LinXar can show them as cards with Accept / Decline buttons. (Other XMTP
// apps would just show the text. XMTP also supports fully custom content
// types, a natural next step.)
const VISIT_MARKER = "🏠 LINXAR_VISIT ";

export type VisitRequest = {
  kind: "request";
  listingId: string;
  listingTitle: string;
  when: string; // ISO date/time chosen by the buyer
  note: string;
};
export type VisitResponse = {
  kind: "response";
  requestId: string; // the XMTP message id of the request being answered
  accepted: boolean;
};
export type VisitMessage = VisitRequest | VisitResponse;

export function encodeVisit(visit: VisitMessage): string {
  return VISIT_MARKER + JSON.stringify(visit);
}

export function decodeVisit(text: unknown): VisitMessage | null {
  if (typeof text !== "string" || !text.startsWith(VISIT_MARKER)) return null;
  try {
    const parsed = JSON.parse(text.slice(VISIT_MARKER.length)) as VisitMessage;
    return parsed.kind === "request" || parsed.kind === "response" ? parsed : null;
  } catch {
    return null;
  }
}
