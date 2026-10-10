"use client";

import { useState } from "react";
import { CloseIcon } from "./icons";

// Lets the user pick photos and shows previews before anything is uploaded.
// To clear it, the parent gives it a new `key`, which resets it.
export function PhotoPicker({
  max = 6,
  label = "Photos",
  onChange,
}: {
  max?: number;
  label?: string;
  onChange: (photos: File[]) => void;
}) {
  const [items, setItems] = useState<{ file: File; url: string }[]>([]);

  function update(next: { file: File; url: string }[]) {
    setItems(next);
    onChange(next.map((item) => item.file));
  }

  function add(files: FileList | null) {
    if (!files) return;
    const added = Array.from(files)
      .slice(0, max - items.length)
      // createObjectURL makes a temporary local link to preview the photo
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    update([...items, ...added]);
  }

  function remove(index: number) {
    URL.revokeObjectURL(items[index].url);
    update(items.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">
        {label} <span className="font-normal text-muted">({items.length}/{max}, max 5 MB each)</span>
      </span>
      <div className="grid grid-cols-3 gap-2">
        {items.map((item, i) => (
          <div key={item.url} className="relative aspect-square overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
              aria-label="Remove photo"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {items.length < max && (
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted hover:border-brand hover:text-brand">
            <span className="text-xl leading-none">+</span>
            Add
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                add(e.target.files);
                e.target.value = ""; // allow picking the same file again
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}
