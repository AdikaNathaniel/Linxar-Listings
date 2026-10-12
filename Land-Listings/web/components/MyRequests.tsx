"use client";

import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { useMetadata } from "./useMetadata";

// A registration request, as getRequest() returns it (see PropertyRegistry.sol)
export type RegistrationRequest = {
  id: bigint;
  applicant: Address;
  status: number; // 0 Pending, 1 Approved, 2 Rejected
  submittedAt: bigint;
  reviewedBy: Address;
  propertyId: bigint;
  deedHash: Hex;
  metadataCID: string;
};

export const RequestStatus = { Pending: 0, Approved: 1, Rejected: 2 } as const;
const STATUS_LABELS = ["Waiting for a verifier", "Approved", "Rejected"];
const STATUS_STYLES = [
  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-success-soft text-success",
  "bg-danger-soft text-danger",
];

type Props = {
  requests: RegistrationRequest[];
  // The rejection reason isn't kept in contract storage, only in the
  // RegistrationRejected EVENT, so it has to be looked up in the logs.
  loadRejectionReason: (requestId: bigint) => Promise<string | null>;
};

// The owner's registration requests and what happened to them
export function MyRequests({ requests, loadRejectionReason }: Props) {
  if (requests.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">My registration requests</h2>
        <p className="text-sm text-muted">A verifier checks each deed before the property NFT is created.</p>
      </div>
      <div className="space-y-2">
        {requests.map((request) => (
          <RequestRow key={request.id.toString()} request={request} loadRejectionReason={loadRejectionReason} />
        ))}
      </div>
    </section>
  );
}

function RequestRow({
  request,
  loadRejectionReason,
}: {
  request: RegistrationRequest;
  loadRejectionReason: (requestId: bigint) => Promise<string | null>;
}) {
  const metadata = useMetadata(request.metadataCID);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (request.status !== RequestStatus.Rejected) return;
    loadRejectionReason(request.id).then(setReason);
  }, [request.id, request.status, loadRejectionReason]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Request #{request.id.toString()}</p>
        <p className="truncate font-semibold">{metadata?.title ?? "Loading…"}</p>
        <p className="text-xs text-muted">
          {request.status === RequestStatus.Pending && "A verifier will review your documents."}
          {request.status === RequestStatus.Approved &&
            `Approved: you now own Property NFT #${request.propertyId} (see My properties).`}
          {request.status === RequestStatus.Rejected && `Reason: ${reason ?? "…"}`}
        </p>
      </div>
      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[request.status]}`}>
        {STATUS_LABELS[request.status]}
      </span>
    </div>
  );
}
