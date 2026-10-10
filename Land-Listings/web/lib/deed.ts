// =============================================================================
// Turning a title-deed number into a deed HASH
// =============================================================================
// PropertyRegistry never stores the deed number itself, only a keccak256
// hash of it: a 32-byte fingerprint. The same text always gives the same
// hash, which is how the contract spots a deed being registered twice.
//
// But "ga-12345 2019" and "GA-12345-2019 " are different TEXT, so they would
// give different hashes and slip past the duplicate check. So we tidy the
// number first: capitals only, and spaces turned into dashes.

import { keccak256, toBytes, type Hex } from "viem";

export function normalizeDeedNumber(deedNumber: string): string {
  return deedNumber.trim().toUpperCase().replace(/\s+/g, "-");
}

export function deedHash(deedNumber: string): Hex {
  return keccak256(toBytes(normalizeDeedNumber(deedNumber)));
}
