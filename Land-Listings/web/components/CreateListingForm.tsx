"use client";

import { useState, type FormEvent } from "react";
import { gatewayUrl } from "../lib/ipfs";
import {
  AMENITIES,
  CATEGORIES,
  LISTING_TYPES,
  ListingType,
  PricePeriod,
  REGIONS,
} from "../lib/listingOptions";
import { Field } from "./Field";
import { InfoIcon, Spinner } from "./icons";
import type { OwnedProperty } from "./MyProperties";
import { PhotoPicker } from "./PhotoPicker";
import { useMetadata } from "./useMetadata";

// Everything the seller fills in. The page splits it in two:
//   - photos, title, description, address, amenities → IPFS (via /api/upload)
//   - property, type, category, period, price, size, region → on-chain (createListing)
export type ListingFormValues = {
  existingImages: string[]; // CIDs of the property's photos, already on IPFS: reused, not re-uploaded
  propertyId: bigint | null; // which property NFT is being listed
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

function emptyValues(propertyId: bigint | null): ListingFormValues {
  return {
    existingImages: [],
    propertyId,
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
}

// Sensible default price period for each listing type
const DEFAULT_PERIOD = [PricePeriod.OneOff, PricePeriod.PerMonth, PricePeriod.PerYear];

type Props = {
  properties: OwnedProperty[]; // the wallet's property NFTs: you can only list these
  initialPropertyId: bigint | null;
  busy: boolean;
  disabled: boolean;
  onRegisterFirst: () => void;
  // Returns true if the listing was created, so the form can clear itself.
  onSubmit: (values: ListingFormValues) => Promise<boolean>;
};

export function CreateListingForm({ properties, initialPropertyId, busy, disabled, onRegisterFirst, onSubmit }: Props) {
  const [values, setValues] = useState<ListingFormValues>(() =>
    emptyValues(initialPropertyId ?? properties[0]?.id ?? null),
  );
  const [resetKey, setResetKey] = useState(0); // bumping this clears the photo picker

  // The chosen property's details on IPFS: its photos and address are reused,
  // so the owner doesn't have to upload the same pictures again.
  const selected = properties.find((p) => p.id === values.propertyId);
  const propertyMetadata = useMetadata(selected?.metadataCID);
  const propertyImages = propertyMetadata?.images ?? [];
  const photoCount = propertyImages.length + values.photos.length;

  function update<K extends keyof ListingFormValues>(key: K, value: ListingFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
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
    const created = await onSubmit({
      ...values,
      existingImages: propertyImages,
      // Left blank? Use the address the property was registered with.
      address: values.address.trim() || propertyMetadata?.address || "",
    });
    if (created) {
      setValues(emptyValues(values.propertyId));
      setResetKey((k) => k + 1);
    }
  }

  // Without a property NFT there's nothing you're allowed to list:
  // the contract would reject it with NotAuthorizedForProperty.
  if (properties.length === 0) {
    return (
      <div className="mt-3 space-y-4">
        <p className="text-sm text-muted">
          To list a property you must own its NFT. Register your property first, then come back here.
        </p>
        <button
          onClick={onRegisterFirst}
          className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-strong"
        >
          Register a property
        </button>
      </div>
    );
  }

  const isSale = values.listingType === ListingType.Sale;

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <Field label="Property" hint="The property NFT this listing is for">
        <select
          className="input"
          value={values.propertyId?.toString() ?? ""}
          onChange={(e) => update("propertyId", BigInt(e.target.value))}
          required
        >
          {properties.map((property) => (
            <option key={property.id.toString()} value={property.id.toString()}>
              Property NFT #{property.id.toString()}
            </option>
          ))}
        </select>
      </Field>

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
            placeholder={propertyMetadata?.address || "East Legon"}
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

      {/* Photos from the property's registration: already on IPFS, reused by CID */}
      {propertyImages.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">
            Photos from your property <span className="font-normal text-muted">(already on IPFS, reused)</span>
          </span>
          <div className="grid grid-cols-3 gap-2">
            {propertyImages.map((cid, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={cid}
                src={gatewayUrl(cid)}
                alt={`Property photo ${i + 1}`}
                className="aspect-square w-full rounded-lg object-cover"
              />
            ))}
          </div>
        </div>
      )}

      <PhotoPicker
        key={resetKey}
        label={propertyImages.length > 0 ? "Extra photos (optional)" : "Photos"}
        onChange={(photos) => update("photos", photos)}
      />

      <button
        type="submit"
        disabled={busy || disabled || photoCount === 0 || values.propertyId === null}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Spinner />}
        {busy
          ? "Working…"
          : propertyMetadata === undefined
            ? "Loading property photos…"
            : photoCount === 0
              ? "Add a photo to continue"
              : "Create listing"}
      </button>

      <p className="flex gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
        The listing&apos;s details (and any extra photos) are uploaded to IPFS first. Then MetaMask asks you to confirm
        one transaction. The contract checks with the property registry that you own this property before accepting it.
      </p>
    </form>
  );
}
