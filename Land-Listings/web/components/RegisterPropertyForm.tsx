"use client";

import { useState, type FormEvent } from "react";
import { normalizeDeedNumber } from "../lib/deed";
import { Field } from "./Field";
import { InfoIcon, Spinner } from "./icons";
import { PhotoPicker } from "./PhotoPicker";

// What the owner fills in to register a property:
//   - the deed number → hashed, the hash goes ON-CHAIN (never the number itself)
//   - name, address, description, photos → IPFS (via /api/upload)
export type PropertyFormValues = {
  deedNumber: string;
  title: string;
  address: string;
  description: string;
  photos: File[];
};

const EMPTY: PropertyFormValues = { deedNumber: "", title: "", address: "", description: "", photos: [] };

type Props = {
  busy: boolean;
  disabled: boolean;
  onSubmit: (values: PropertyFormValues) => Promise<boolean>; // true = registered
};

export function RegisterPropertyForm({ busy, disabled, onSubmit }: Props) {
  const [values, setValues] = useState<PropertyFormValues>(EMPTY);
  const [resetKey, setResetKey] = useState(0); // bumping this clears the photo picker

  function update<K extends keyof PropertyFormValues>(key: K, value: PropertyFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (await onSubmit(values)) {
      setValues(EMPTY);
      setResetKey((k) => k + 1);
    }
  }

  const normalized = normalizeDeedNumber(values.deedNumber);

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <Field
        label="Title deed / land certificate number"
        hint={normalized ? `Will be registered as: ${normalized}` : "e.g. GA-12345-2019"}
      >
        <input
          className="input font-mono"
          placeholder="GA-12345-2019"
          value={values.deedNumber}
          onChange={(e) => update("deedNumber", e.target.value)}
          required
        />
      </Field>

      <Field label="Property name">
        <input
          className="input"
          placeholder="Plot 12, Palm Street"
          value={values.title}
          onChange={(e) => update("title", e.target.value)}
          required
        />
      </Field>

      <Field label="Address">
        <input
          className="input"
          placeholder="East Legon, Accra"
          value={values.address}
          onChange={(e) => update("address", e.target.value)}
        />
      </Field>

      <Field label="Description">
        <textarea
          className="input min-h-20 resize-y"
          placeholder="Land size, boundaries, buildings on it, survey plan details…"
          value={values.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </Field>

      <PhotoPicker key={resetKey} onChange={(photos) => update("photos", photos)} />

      <button
        type="submit"
        disabled={busy || disabled || values.photos.length === 0}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Spinner />}
        {busy ? "Working…" : values.photos.length === 0 ? "Add a photo to continue" : "Register property"}
      </button>

      <p className="flex gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
        You&apos;ll receive an NFT: the on-chain record of this property. Only a fingerprint (hash) of the deed number
        goes on-chain, and each deed can only ever be registered once.
      </p>
    </form>
  );
}
