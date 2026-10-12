"use client";

import { useState, type FormEvent } from "react";
import { isAddress } from "viem";
import { deedHash } from "../lib/deed";
import { gatewayUrl } from "../lib/ipfs";
import { Field } from "./Field";
import { shortAddress } from "./ListingCard";
import type { RegistrationRequest } from "./MyRequests";
import { PhotoPicker } from "./PhotoPicker";
import { useMetadata } from "./useMetadata";

export type BadgeFormValues = {
  agent: string; // the agent's wallet address
  name: string;
  licence: string;
  agency: string;
  photos: File[];
};

type Props = {
  pendingRequests: RegistrationRequest[];
  busy: boolean;
  onApprove: (requestId: bigint) => void;
  onReject: (requestId: bigint, reason: string) => void;
  onIssueBadge: (values: BadgeFormValues) => Promise<boolean>;
  onRevokeBadge: (agent: `0x${string}`) => Promise<boolean>;
};

// Only shown to wallets holding VERIFIER_ROLE. The contract enforces that
// with onlyRole(VERIFIER_ROLE); hiding this panel from everyone else is
// just tidiness, not security.
export function VerifierPanel({ pendingRequests, busy, onApprove, onReject, onIssueBadge, onRevokeBadge }: Props) {
  return (
    <section className="space-y-4 rounded-3xl border-2 border-brand/40 bg-brand-soft/40 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">Verifier dashboard</p>
        <h2 className="text-lg font-semibold">Registration requests ({pendingRequests.length} waiting)</h2>
        <p className="text-sm text-muted">
          Check each deed off-chain (e.g. with the Lands Commission) before approving. Your decision is recorded
          on-chain, under your address, forever.
        </p>
      </div>

      {pendingRequests.length === 0 ? (
        <p className="rounded-2xl bg-surface p-4 text-sm text-muted">No requests waiting. 🎉</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {pendingRequests.map((request) => (
            <RequestReview
              key={request.id.toString()}
              request={request}
              busy={busy}
              onApprove={onApprove}
              onReject={onReject}
            />
          ))}
        </div>
      )}

      <BadgeTools busy={busy} onIssueBadge={onIssueBadge} onRevokeBadge={onRevokeBadge} />
    </section>
  );
}

function RequestReview({
  request,
  busy,
  onApprove,
  onReject,
}: {
  request: RegistrationRequest;
  busy: boolean;
  onApprove: (requestId: bigint) => void;
  onReject: (requestId: bigint, reason: string) => void;
}) {
  const metadata = useMetadata(request.metadataCID);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  // THE HASH CHECK: re-hash the deed number from the documents and compare
  // with the hash stored on-chain. If they match, the documents really are
  // for the deed this request will lock.
  const hashMatches = metadata?.deedNumber ? deedHash(metadata.deedNumber) === request.deedHash : null;

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
          {metadata?.images[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gatewayUrl(metadata.images[0])} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted">
            Request #{request.id.toString()} · from <span className="font-mono">{shortAddress(request.applicant)}</span>
          </p>
          <p className="truncate font-semibold">{metadata?.title ?? "Loading…"}</p>
          <p className="truncate text-sm text-muted">{metadata?.address}</p>
        </div>
      </div>

      <dl className="space-y-1 rounded-xl bg-surface-2 p-3 font-mono text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Deed number</dt>
          <dd className="font-semibold">{metadata?.deedNumber ?? "not provided"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">On-chain hash</dt>
          <dd>{request.deedHash.slice(0, 14)}…</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Hash check</dt>
          <dd className={hashMatches ? "text-success" : "text-danger"}>
            {hashMatches === null ? "can't check" : hashMatches ? "✔ matches" : "✘ DOES NOT match"}
          </dd>
        </div>
      </dl>

      {metadata?.description && <p className="line-clamp-3 text-xs text-muted">{metadata.description}</p>}
      {metadata && metadata.images.length > 0 && (
        <a
          href={gatewayUrl(request.metadataCID)}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-brand underline"
        >
          Open full documents on IPFS ({metadata.images.length} photo{metadata.images.length > 1 ? "s" : ""})
        </a>
      )}

      {rejecting ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onReject(request.id, reason.trim());
          }}
          className="space-y-2"
        >
          <input
            className="input"
            placeholder="Reason (public), e.g. Deed not found at the Lands Commission"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Reject request
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="text-xs text-muted">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onApprove(request.id)}
            disabled={busy}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
          >
            Approve &amp; mint NFT
          </button>
          <button
            onClick={() => setRejecting(true)}
            disabled={busy}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-danger hover:text-danger disabled:opacity-50"
          >
            Reject…
          </button>
        </div>
      )}
    </div>
  );
}

// Issue and revoke soulbound "Verified Agent" badges
function BadgeTools({
  busy,
  onIssueBadge,
  onRevokeBadge,
}: {
  busy: boolean;
  onIssueBadge: (values: BadgeFormValues) => Promise<boolean>;
  onRevokeBadge: (agent: `0x${string}`) => Promise<boolean>;
}) {
  const empty: BadgeFormValues = { agent: "", name: "", licence: "", agency: "", photos: [] };
  const [values, setValues] = useState(empty);
  const [resetKey, setResetKey] = useState(0);
  const [revokeAddress, setRevokeAddress] = useState("");

  const update = <K extends keyof BadgeFormValues>(key: K, value: BadgeFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function issue(event: FormEvent) {
    event.preventDefault();
    if (await onIssueBadge(values)) {
      setValues(empty);
      setResetKey((k) => k + 1);
    }
  }

  async function revoke(event: FormEvent) {
    event.preventDefault();
    if (isAddress(revokeAddress) && (await onRevokeBadge(revokeAddress))) setRevokeAddress("");
  }

  const validAgent = isAddress(values.agent);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <form onSubmit={issue} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <h3 className="font-semibold">Issue a Verified Agent badge</h3>
        <p className="text-xs text-muted">A soulbound NFT: it can&apos;t be sold or transferred, only revoked.</p>
        <Field label="Agent's wallet address" hint={values.agent && !validAgent ? "Not a valid address" : undefined}>
          <input
            className="input font-mono"
            placeholder="0x…"
            value={values.agent}
            onChange={(e) => update("agent", e.target.value.trim())}
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Full name">
            <input className="input" value={values.name} onChange={(e) => update("name", e.target.value)} required />
          </Field>
          <Field label="Licence no.">
            <input className="input" value={values.licence} onChange={(e) => update("licence", e.target.value)} />
          </Field>
        </div>
        <Field label="Agency">
          <input className="input" value={values.agency} onChange={(e) => update("agency", e.target.value)} />
        </Field>
        <PhotoPicker key={resetKey} max={1} label="Agent photo" onChange={(photos) => update("photos", photos)} />
        <button
          type="submit"
          disabled={busy || !validAgent || values.photos.length === 0}
          className="w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
        >
          Issue badge
        </button>
      </form>

      <form onSubmit={revoke} className="space-y-3 self-start rounded-2xl border border-line bg-surface p-4">
        <h3 className="font-semibold">Revoke a badge</h3>
        <p className="text-xs text-muted">Burns the agent&apos;s badge NFT. Their listings lose the ✔ immediately.</p>
        <input
          className="input font-mono"
          placeholder="0x… agent address"
          value={revokeAddress}
          onChange={(e) => setRevokeAddress(e.target.value.trim())}
          required
        />
        <button
          type="submit"
          disabled={busy || !isAddress(revokeAddress)}
          className="w-full rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:border-danger hover:text-danger disabled:opacity-50"
        >
          Revoke badge
        </button>
      </form>
    </div>
  );
}
