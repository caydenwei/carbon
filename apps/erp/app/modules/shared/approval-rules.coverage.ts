// Tiered-approval coverage check.
//
// Each approval rule represents a half-open range [lowerBoundAmount,
// upperBoundAmount). The "top tier" — the rule(s) with the highest
// lowerBoundAmount for a given documentType — must have at least one rule
// with a null upperBoundAmount so amounts above the top minimum still
// route to an approver. Without this guarantee, a $3M PO can silently
// bypass approval when all rules have explicit ceilings.
//
// Used by:
//   - approval-rules.new.tsx and approval-rules.$id.tsx (save-time block)
//   - ApprovalRules.tsx (list-view warning banner)

import type { ApprovalRule } from "./types";

type Candidate = {
  id?: string | null;
  lowerBoundAmount: number;
  upperBoundAmount: number | null;
};

type CoverageInput = {
  existingRules: Pick<
    ApprovalRule,
    "id" | "documentType" | "lowerBoundAmount" | "upperBoundAmount"
  >[];
  documentType: ApprovalRule["documentType"];
  candidate: Candidate;
};

/**
 * Returns true if, after applying the candidate save, at least one rule
 * at the highest `lowerBoundAmount` for the document type has a null
 * `upperBoundAmount`. Returns false when the save would leave a gap
 * above the top tier.
 */
export function topTierWouldBeUnbounded({
  existingRules,
  documentType,
  candidate
}: CoverageInput): boolean {
  const others = existingRules.filter(
    (r) => r.documentType === documentType && r.id !== candidate.id
  );

  const merged: Pick<ApprovalRule, "lowerBoundAmount" | "upperBoundAmount">[] =
    [
      ...others.map((r) => ({
        lowerBoundAmount: r.lowerBoundAmount ?? 0,
        upperBoundAmount: r.upperBoundAmount ?? null
      })),
      {
        lowerBoundAmount: candidate.lowerBoundAmount,
        upperBoundAmount: candidate.upperBoundAmount
      }
    ];

  const highestLower = merged.reduce(
    (max, r) => Math.max(max, r.lowerBoundAmount ?? 0),
    0
  );
  return merged
    .filter((r) => (r.lowerBoundAmount ?? 0) === highestLower)
    .some((r) => r.upperBoundAmount == null);
}

/**
 * Read-only variant used by the list-view banner. No candidate — just
 * checks the current set of rules. Returns the maximum `upperBoundAmount`
 * at the highest tier if coverage is incomplete, or null when the top is
 * unbounded.
 */
export function topTierExplicitMax(
  rules: Pick<
    ApprovalRule,
    "documentType" | "lowerBoundAmount" | "upperBoundAmount"
  >[],
  documentType: ApprovalRule["documentType"]
): number | null {
  const forType = rules.filter((r) => r.documentType === documentType);
  if (forType.length === 0) return null;

  const highestLower = forType.reduce(
    (max, r) => Math.max(max, r.lowerBoundAmount ?? 0),
    0
  );
  const atHighest = forType.filter(
    (r) => (r.lowerBoundAmount ?? 0) === highestLower
  );
  if (atHighest.some((r) => r.upperBoundAmount == null)) return null;

  return atHighest.reduce(
    (max, r) => Math.max(max, r.upperBoundAmount ?? 0),
    0
  );
}
