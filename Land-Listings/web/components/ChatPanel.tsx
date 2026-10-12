"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Address } from "viem";
import {
  addressOfInbox,
  decodeVisit,
  encodeVisit,
  openDm,
  type VisitRequest,
  type XmtpClient,
  type XmtpDm,
  type XmtpMessage,
} from "../lib/xmtp";
import { CloseIcon, Spinner } from "./icons";
import { shortAddress } from "./ListingCard";

// Who to chat with, and (optionally) which listing it's about
export type ChatTarget = { address: Address; listingId?: bigint; listingTitle?: string };

type Props = {
  client: XmtpClient | null; // null until messaging is enabled
  enabling: boolean;
  target: ChatTarget | null; // set when "Message seller" is clicked
  onEnable: () => void;
  onClose: () => void;
  onError: (message: string) => void;
};

// The messaging window: a list of conversations, or one open conversation
export function ChatPanel({ client, enabling, target, onEnable, onClose, onError }: Props) {
  const [openPeer, setOpenPeer] = useState<ChatTarget | null>(target);
  // Follow "Message seller" clicks: show that conversation straight away
  const [lastTarget, setLastTarget] = useState(target);
  if (target !== lastTarget) {
    setLastTarget(target);
    setOpenPeer(target);
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex h-[min(600px,calc(100vh-6rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <p className="font-semibold">
            {openPeer ? `Chat with ${shortAddress(openPeer.address)}` : "Messages"}
          </p>
          <p className="text-xs text-muted">End-to-end encrypted · via XMTP</p>
        </div>
        <div className="flex items-center gap-2">
          {openPeer && client && (
            <button onClick={() => setOpenPeer(null)} className="text-xs font-medium text-brand hover:underline">
              ← All chats
            </button>
          )}
          <button onClick={onClose} aria-label="Close messages" className="text-muted hover:text-foreground">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {!client ? (
        <EnableMessaging enabling={enabling} onEnable={onEnable} />
      ) : openPeer ? (
        <Conversation key={openPeer.address} client={client} peer={openPeer} onError={onError} />
      ) : (
        <ConversationList client={client} onOpen={(address) => setOpenPeer({ address })} onError={onError} />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step 0: enable messaging (one free signature)
// -----------------------------------------------------------------------------
function EnableMessaging({ enabling, onEnable }: { enabling: boolean; onEnable: () => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 p-6 text-sm">
      <p className="text-base font-semibold">Chat with sellers and buyers, wallet to wallet</p>
      <ul className="list-disc space-y-1 pl-5 text-muted">
        <li>Your wallet address is your identity: no phone number or email.</li>
        <li>Messages are end-to-end encrypted: only you and the other person can read them.</li>
        <li>Nothing is stored on a LinXar server or on the blockchain.</li>
      </ul>
      <p className="text-muted">
        MetaMask will ask you to <strong>sign a message</strong> once. It&apos;s free: no gas, no transaction.
      </p>
      <button
        onClick={onEnable}
        disabled={enabling}
        className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
      >
        {enabling && <Spinner />}
        {enabling ? "Waiting for your signature…" : "Enable messaging"}
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// All conversations, newest activity first, updated live
// -----------------------------------------------------------------------------
type ConversationSummary = { address: Address; preview: string; at: number };

function ConversationList({
  client,
  onOpen,
  onError,
}: {
  client: XmtpClient;
  onOpen: (address: Address) => void;
  onError: (message: string) => void;
}) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await client.conversations.sync(); // fetch new conversations from the network
      const dms = (await client.conversations.listDms()) as XmtpDm[];
      const summaries = await Promise.all(
        dms.map(async (dm) => {
          const address = await addressOfInbox(client, await dm.peerInboxId());
          const last = (await dm.lastMessage()) as XmtpMessage | undefined;
          const visit = decodeVisit(last?.content);
          const preview = visit
            ? visit.kind === "request"
              ? "📅 Visit request"
              : visit.accepted
                ? "✅ Visit accepted"
                : "❌ Visit declined"
            : typeof last?.content === "string"
              ? last.content
              : "";
          return address ? { address, preview, at: last?.sentAt.getTime() ?? 0 } : null;
        }),
      );
      if (!cancelled) setItems(summaries.filter((s): s is ConversationSummary => s !== null).sort((a, b) => b.at - a.at));
    };
    load().catch((err) => onError(String(err)));

    // LIVE: any new message in any conversation → refresh the list
    let stream: { end: () => Promise<unknown> } | undefined;
    client.conversations
      .streamAllMessages({ onValue: () => load().catch(() => {}) })
      .then((s) => {
        stream = s;
        if (cancelled) s.end();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stream?.end();
    };
  }, [client, onError]);

  if (items === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted">
        No conversations yet. Open a listing and click &quot;Message seller&quot;.
      </p>
    );
  }
  return (
    <div className="flex-1 divide-y divide-line overflow-y-auto">
      {items.map((item) => (
        <button
          key={item.address}
          onClick={() => onOpen(item.address)}
          className="block w-full px-4 py-3 text-left hover:bg-surface-2"
        >
          <p className="font-mono text-sm font-semibold">{shortAddress(item.address)}</p>
          <p className="truncate text-sm text-muted">{item.preview}</p>
        </button>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// One conversation: messages, visit requests, and the input box
// -----------------------------------------------------------------------------
function Conversation({
  client,
  peer,
  onError,
}: {
  client: XmtpClient;
  peer: ChatTarget;
  onError: (message: string) => void;
}) {
  const [dm, setDm] = useState<XmtpDm | null>(null);
  const [messages, setMessages] = useState<XmtpMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showVisitForm, setShowVisitForm] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Open the conversation, load its history, then stream new messages live
  useEffect(() => {
    let cancelled = false;
    let stream: { end: () => Promise<unknown> } | undefined;
    const reload = async (conversation: XmtpDm) => {
      const all = (await conversation.messages()) as XmtpMessage[];
      // Keep only text messages (XMTP also sends system messages, e.g. "group updated")
      const texts = all
        .filter((m) => typeof m.content === "string")
        .sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : 1));
      if (!cancelled) setMessages(texts);
    };
    (async () => {
      const conversation = await openDm(client, peer.address);
      if (cancelled) return;
      setDm(conversation);
      await conversation.sync();
      await reload(conversation);
      stream = await conversation.stream({ onValue: () => reload(conversation).catch(() => {}) });
      if (cancelled) stream.end();
    })().catch((err) => onError(String(err)));
    return () => {
      cancelled = true;
      stream?.end();
    };
  }, [client, peer.address, onError]);

  // Keep the newest message in view
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(content: string) {
    if (!dm) return;
    try {
      setSending(true);
      await dm.sendText(content); // encrypted on this device, then sent over XMTP
      setMessages((await dm.messages() as XmtpMessage[]).filter((m) => typeof m.content === "string").sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : 1)));
    } catch (err) {
      onError(String(err));
    } finally {
      setSending(false);
    }
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    await send(trimmed);
  }

  // Which visit requests have been answered? requestId → accepted?
  const answers = new Map<string, boolean>();
  for (const m of messages) {
    const visit = decodeVisit(m.content);
    if (visit?.kind === "response") answers.set(visit.requestId, visit.accepted);
  }

  return (
    <>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {!dm && (
          <div className="flex justify-center py-8 text-muted">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {dm && messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            Say hello{peer.listingTitle ? ` about “${peer.listingTitle}”` : ""}, or request a visit.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.senderInboxId === client.inboxId;
          const visit = decodeVisit(m.content);
          if (visit?.kind === "response") return null; // shown on the request card instead
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              {visit?.kind === "request" ? (
                <VisitCard
                  visit={visit}
                  mine={mine}
                  answer={answers.get(m.id)}
                  disabled={sending}
                  onAnswer={(accepted) => send(encodeVisit({ kind: "response", requestId: m.id, accepted }))}
                />
              ) : (
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    mine ? "bg-brand text-on-brand" : "bg-surface-2"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.content as string}</p>
                  <p className="mt-0.5 text-[10px] opacity-60">{m.sentAt.toLocaleTimeString()}</p>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {showVisitForm && (
        <VisitForm
          peer={peer}
          disabled={sending || !dm}
          onCancel={() => setShowVisitForm(false)}
          onSend={async (visit) => {
            await send(encodeVisit(visit));
            setShowVisitForm(false);
          }}
        />
      )}

      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-line p-3">
        <button
          type="button"
          onClick={() => setShowVisitForm((v) => !v)}
          title="Request a visit"
          className="rounded-xl border border-line px-2.5 py-2 text-sm hover:border-brand"
        >
          📅
        </button>
        <input
          className="input flex-1"
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!dm}
        />
        <button
          type="submit"
          disabled={sending || !dm || !text.trim()}
          className="rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-on-brand disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </>
  );
}

// A visit request, shown as a card. The RECIPIENT gets Accept / Decline.
function VisitCard({
  visit,
  mine,
  answer,
  disabled,
  onAnswer,
}: {
  visit: VisitRequest;
  mine: boolean;
  answer: boolean | undefined;
  disabled: boolean;
  onAnswer: (accepted: boolean) => void;
}) {
  return (
    <div className="w-[85%] rounded-2xl border border-brand/40 bg-brand-soft p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">📅 Visit request</p>
      <p className="mt-1 font-semibold">{visit.listingTitle || `Listing #${visit.listingId}`}</p>
      <p>{new Date(visit.when).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}</p>
      {visit.note && <p className="mt-1 text-muted">“{visit.note}”</p>}
      {answer === undefined ? (
        mine ? (
          <p className="mt-2 text-xs text-muted">Waiting for a reply…</p>
        ) : (
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => onAnswer(true)}
              disabled={disabled}
              className="rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-on-brand disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => onAnswer(false)}
              disabled={disabled}
              className="rounded-lg border border-line bg-surface px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        )
      ) : (
        <p className={`mt-2 text-xs font-semibold ${answer ? "text-success" : "text-danger"}`}>
          {answer ? "✅ Accepted" : "❌ Declined"}
        </p>
      )}
    </div>
  );
}

// The buyer's form: pick a date and time, add a note
function VisitForm({
  peer,
  disabled,
  onCancel,
  onSend,
}: {
  peer: ChatTarget;
  disabled: boolean;
  onCancel: () => void;
  onSend: (visit: VisitRequest) => void;
}) {
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend({
          kind: "request",
          listingId: peer.listingId?.toString() ?? "",
          listingTitle: peer.listingTitle ?? "",
          when: new Date(when).toISOString(),
          note: note.trim(),
        });
      }}
      className="space-y-2 border-t border-line bg-surface-2 p-3"
    >
      <p className="text-sm font-semibold">Request a visit{peer.listingTitle ? `: ${peer.listingTitle}` : ""}</p>
      <input
        className="input"
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        required
      />
      <input
        className="input"
        placeholder="Note (optional), e.g. I'll bring a surveyor"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled || !when}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand disabled:opacity-50"
        >
          Send request
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-muted">
          Cancel
        </button>
      </div>
    </form>
  );
}
