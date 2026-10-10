"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  AMENITIES,
  CATEGORIES,
  LISTING_TYPES,
  ListingType,
  PricePeriod,
  REGIONS,
} from "../lib/listingOptions";
import { CloseIcon, InfoIcon, Spinner } from "./icons";

// Everything the seller fills in. The page splits it in two:
//   - photos, title, description, address, amenities → IPFS (via /api/upload)
//   - type, category, period, price, size, region     → on-chain (createListing)
export type ListingFormValues = {
  listingType: number;
  category: number;
  pricePeriod: number;
  price: string; // in ETH, as typed
  sizeSqm: string;
  region: string;
  address: string;
  title: string;
  description: string;
  amenities: string[];
  photos: File[];
};

const MAX_PHOTOS = 6;

const EMPTY: ListingFormValues = {
  listingType: ListingType.Sale,
  category: 0,
  pricePeriod: PricePeriod.OneOff,
  price: "",
  sizeSqm: "",
  region: "Greater Accra",
  address: "",
  title: "",
  description: "",
  amenities: [],
  photos: [],
};

// Sensible default price period for each listing type
const DEFAULT_PERIOD = [PricePeriod.OneOff, PricePeriod.PerMonth, PricePeriod.PerYear];

type Props = {
  busy: boolean;
  disabled: boolean;
  // Returns true if the listing was created, so the form can clear itself.
  onSubmit: (values: ListingFormValues) => Promise<boolean>;
};

export function CreateListingForm({ busy, disabled, onSubmit }: Props) {
  const [values, setValues] = useState<ListingFormValues>(EMPTY);
  const [previews, setPreviews] = useState<string[]>([]); // local preview URLs for the photos

  function update<K extends keyof ListingFormValues>(key: K, value: ListingFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = MAX_PHOTOS - values.photos.length;
    const added = Array.from(files).slice(0, room);
    update("photos", [...values.photos, ...added]);
    // createObjectURL makes a temporary local link so we can preview the
    // photo before it's uploaded anywhere.
    setPreviews((p) => [...p, ...added.map((file) => URL.createObjectURL(file))]);
  }

  function removePhoto(index: number) {
    URL.revokeObjectURL(previews[index]);
    update("photos", values.photos.filter((_, i) => i !== index));
    setPreviews((p) => p.filter((_, i) => i !== index));
  }

  function toggleAmenity(amenity: string) {
    update(
      "amenities",
      values.amenities.includes(amenity)
        ? values.amenities.filter((a) => a !== amenity)
        : [...values.amenities, amenity],
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault(); // stop the browser reloading the page
    const created = await onSubmit(values);
    if (created) {
      previews.forEach((url) => URL.revokeObjectURL(url));
      setPreviews([]);
      setValues(EMPTY);
    }
  }

  const isSale = values.listingType === ListingType.Sale;

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      {/* Listing type: Sale / Rent / Lease */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1 text-sm">
        {LISTING_TYPES.map((label, type) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              update("listingType", type);
              update("pricePeriod", DEFAULT_PERIOD[type]);
            }}
            className={`rounded-lg py-1.5 font-medium ${
              values.listingType === type ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {label.replace("For ", "")}
          </button>
        ))}
      </div>

      <Field label="Title">
        <input
          className="input"
          placeholder="3-bedroom house with garden"
          value={values.title}
          onChange={(e) => update("title", e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select className="input" value={values.category} onChange={(e) => update("category", Number(e.target.value))}>
            {CATEGORIES.map((label, value) => (
              <option key={label} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Size (m²)">
          <input
            className="input"
            type="number"
            min="0"
            step="1"
            placeholder="450"
            value={values.sizeSqm}
            onChange={(e) => update("sizeSqm", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Region">
          <select className="input" value={values.region} onChange={(e) => update("region", e.target.value)}>
            {REGIONS.map((region) => (
              <option key={region}>{region}</option>
            ))}
          </select>
        </Field>
        <Field label="Area / street">
          <input
            className="input"
            placeholder="East Legon"
            value={values.address}
            onChange={(e) => update("address", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="Price (ETH)">
          <input
            className="input"
            type="number"
            step="any"
            min="0"
            placeholder="2.5"
            value={values.price}
            onChange={(e) => update("price", e.target.value)}
            required
          />
        </Field>
        <Field label="Per">
          <select
            className="input"
            value={values.pricePeriod}
            disabled={isSale}
            onChange={(e) => update("pricePeriod", Number(e.target.value))}
          >
            <option value={PricePeriod.OneOff}>One-off</option>
            <option value={PricePeriod.PerMonth}>Month</option>
            <option value={PricePeriod.PerYear}>Year</option>
          </select>
        </Field>
      </div>

      <Field label="Description">
        <textarea
          className="input min-h-24 resize-y"
          placeholder="Describe the property: rooms, condition, access, documents available…"
          value={values.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </Field>

      <div className="space-y-1.5">
        <span className="text-sm font-medium">Amenities</span>
        <div className="flex flex-wrap gap-1.5">
          {AMENITIES.map((amenity) => {
            const on = values.amenities.includes(amenity);
            return (
              <button
                key={amenity}
                type="button"
                onClick={() => toggleAmenity(amenity)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  on ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-foreground"
                }`}
              >
                {amenity}
              </button>
            );
          })}
        </div>
      </div>

      {/* Photos */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">
          Photos <span className="font-normal text-muted">({values.photos.length}/{MAX_PHOTOS}, max 5 MB each)</span>
        </span>
        <div className="grid grid-cols-3 gap-2">
          {previews.map((url, i) => (
            <div key={url} className="relative aspect-square overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                aria-label="Remove photo"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {values.photos.length < MAX_PHOTOS && (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted hover:border-brand hover:text-brand">
              <span className="text-xl leading-none">+</span>
              Add
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addPhotos(e.target.files);
                  e.target.value = ""; // allow picking the same file again
                }}
              />
            </label>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={busy || disabled || values.photos.length === 0}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Spinner />}
        {busy ? "Working…" : values.photos.length === 0 ? "Add a photo to continue" : "Create listing"}
      </button>

      <p className="flex gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
        Photos and description are uploaded to IPFS first. Then MetaMask asks you to confirm one transaction that
        stores the listing (with the IPFS fingerprint) on the blockchain.
      </p>
    </form>
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
