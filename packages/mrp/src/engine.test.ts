import { describe, expect, it } from "vitest";
import {
  type BomChild,
  type BomExplosionInput,
  computeLowLevelCodes,
  type DemandContributor,
  type DemandPeriod,
  explodeBom,
  makeKey,
  type ReplenishmentSystem,
  splitKey
} from "./engine";

// ─── Test BOM structure ─────────────────────────────────────────────
//
//  M000000001 (Manufactured, Make)
//  ├── P000000001 (Level 1 Purchased, Buy, Pull from Inventory, qty 2)
//  └── L000000001 (Level 1 Made, Make, Pull from Inventory, qty 2)
//      ├── P000000002 (Level 2 Purchase, Buy, Purchase to Order, qty 2)
//      └── P000000003 (Level 2 Made, Make, Make to Order, qty 2)
//          └── P000000004 (Level 3 Purchased, Buy, Pull from Inventory, qty 2)

const M = "M000000001";
const P1 = "P000000001";
const L1 = "L000000001";
const P2 = "P000000002";
const P3 = "P000000003";
const P4 = "P000000004";

const LOC = "loc1";
const PER1 = "per1";

function buildBom(): Map<string, BomChild[]> {
  return new Map([
    [
      M,
      [
        { itemId: P1, quantity: 2, methodType: "Pull from Inventory" },
        { itemId: L1, quantity: 2, methodType: "Pull from Inventory" }
      ]
    ],
    [
      L1,
      [
        { itemId: P2, quantity: 2, methodType: "Purchase to Order" },
        { itemId: P3, quantity: 2, methodType: "Make to Order" }
      ]
    ],
    [P3, [{ itemId: P4, quantity: 2, methodType: "Pull from Inventory" }]]
  ]);
}

function buildReplenishment(): Map<string, ReplenishmentSystem> {
  return new Map<string, ReplenishmentSystem>([
    [M, "Make"],
    [P1, "Buy"],
    [L1, "Make"],
    [P2, "Buy"],
    [P3, "Make"],
    [P4, "Buy"]
  ]);
}

function buildLeadTimes(): Map<string, number> {
  return new Map([
    [M, 7],
    [P1, 7],
    [L1, 7],
    [P2, 7],
    [P3, 7],
    [P4, 7]
  ]);
}

function buildPeriods(): DemandPeriod[] {
  return [
    { id: PER1, startDate: "2026-05-25", endDate: "2026-05-31" },
    { id: "per2", startDate: "2026-06-01", endDate: "2026-06-07" },
    { id: "per3", startDate: "2026-06-08", endDate: "2026-06-14" }
  ];
}

function baseInput(overrides?: Partial<BomExplosionInput>): BomExplosionInput {
  return {
    grossDemand: overrides?.grossDemand ?? new Map(),
    bomByItem: overrides?.bomByItem ?? buildBom(),
    replenishmentSystemByItem:
      overrides?.replenishmentSystemByItem ?? buildReplenishment(),
    leadTimeByItem: overrides?.leadTimeByItem ?? buildLeadTimes(),
    periods: overrides?.periods ?? buildPeriods(),
    onHandByLocationItem: overrides?.onHandByLocationItem ?? new Map(),
    jobSupplyByLocationPeriodItem:
      overrides?.jobSupplyByLocationPeriodItem ?? new Map(),
    topLevelContributors: overrides?.topLevelContributors ?? new Map()
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

describe("splitKey", () => {
  it("splits a standard three-part key", () => {
    expect(splitKey("loc1-per1-item1")).toEqual(["loc1", "per1", "item1"]);
  });

  it("handles item IDs that contain hyphens", () => {
    expect(splitKey("loc1-per1-item-with-hyphens")).toEqual([
      "loc1",
      "per1",
      "item-with-hyphens"
    ]);
  });
});

describe("makeKey", () => {
  it("creates a key from location, period, and item", () => {
    expect(makeKey("loc1", "per1", "item1")).toBe("loc1-per1-item1");
  });
});

// ─── Low-Level Codes ────────────────────────────────────────────────

describe("computeLowLevelCodes", () => {
  it("assigns level 0 to a top-level item with no parents", () => {
    const llc = computeLowLevelCodes(buildBom());
    expect(llc.get(M)).toBe(0);
  });

  it("assigns increasing levels down the BOM tree", () => {
    const llc = computeLowLevelCodes(buildBom());
    expect(llc.get(P1)).toBe(1);
    expect(llc.get(L1)).toBe(1);
    expect(llc.get(P2)).toBe(2);
    expect(llc.get(P3)).toBe(2);
    expect(llc.get(P4)).toBe(3);
  });

  it("traverses through Make-to-Order/Make items", () => {
    const llc = computeLowLevelCodes(buildBom());
    // P3 is Make-to-Order + Make. Previously skipped, leaving P4 at level 0.
    expect(llc.get(P3)).toBe(2);
    expect(llc.get(P4)).toBe(3);
  });

  it("uses the deepest level when an item appears at multiple BOM levels", () => {
    const bom = new Map<string, BomChild[]>([
      [
        "A",
        [
          { itemId: "B", quantity: 1, methodType: "Pull from Inventory" },
          { itemId: "C", quantity: 1, methodType: "Pull from Inventory" }
        ]
      ],
      ["B", [{ itemId: "C", quantity: 1, methodType: "Pull from Inventory" }]]
    ]);
    const llc = computeLowLevelCodes(bom);
    // C appears at level 1 (child of A) and level 2 (child of B)
    expect(llc.get("C")).toBe(2);
  });

  it("handles circular references without infinite loop", () => {
    const bom = new Map<string, BomChild[]>([
      ["A", [{ itemId: "B", quantity: 1, methodType: "Pull from Inventory" }]],
      ["B", [{ itemId: "A", quantity: 1, methodType: "Pull from Inventory" }]]
    ]);
    const llc = computeLowLevelCodes(bom);
    expect(llc.get("A")).toBeDefined();
    expect(llc.get("B")).toBeDefined();
  });
});

// ─── BOM Explosion ──────────────────────────────────────────────────

describe("explodeBom", () => {
  describe("basic demand propagation", () => {
    it("propagates demand from a Make item to its Buy children", () => {
      const grossDemand = new Map([[makeKey(LOC, PER1, M), 1]]);
      const result = explodeBom(baseInput({ grossDemand }));

      expect(result.bomDerivedDemand.get(makeKey(LOC, PER1, P1))).toBe(2);
      expect(result.bomDerivedDemand.get(makeKey(LOC, PER1, L1))).toBe(2);
    });

    it("does not explode BOM for Buy items", () => {
      const grossDemand = new Map([[makeKey(LOC, PER1, P1), 10]]);
      const result = explodeBom(baseInput({ grossDemand }));
      expect(result.bomDerivedDemand.size).toBe(0);
    });

    it("cascades demand through multiple BOM levels", () => {
      const grossDemand = new Map([[makeKey(LOC, PER1, M), 1]]);
      const result = explodeBom(baseInput({ grossDemand }));

      // M→L1 (qty 2) → P2 (qty 2) = 4
      expect(result.bomDerivedDemand.get(makeKey(LOC, PER1, P2))).toBe(4);
    });
  });

  describe("inline production (Make-to-Order + Make)", () => {
    it("propagates demand through Make-to-Order/Make items to their children", () => {
      const grossDemand = new Map([[makeKey(LOC, PER1, M), 1]]);
      const result = explodeBom(baseInput({ grossDemand }));

      // M→L1 (2) → P3 (2) → P4 (2) = 8
      expect(result.grossDemand.get(makeKey(LOC, PER1, P4))).toBe(8);
      expect(result.bomDerivedDemand.get(makeKey(LOC, PER1, P4))).toBe(8);
    });

    it("does not create bomDerivedDemand for the inline production item itself", () => {
      const grossDemand = new Map([[makeKey(LOC, PER1, M), 1]]);
      const result = explodeBom(baseInput({ grossDemand }));

      // P3 is Make-to-Order + Make — should be in grossDemand but NOT bomDerivedDemand
      expect(result.grossDemand.get(makeKey(LOC, PER1, P3))).toBe(4);
      expect(
        result.bomDerivedDemand.get(makeKey(LOC, PER1, P3))
      ).toBeUndefined();
    });
  });

  describe("inventory netting", () => {
    it("reduces net requirement by on-hand inventory", () => {
      const grossDemand = new Map([[makeKey(LOC, PER1, M), 3]]);
      const onHand = new Map([[`${LOC}-${M}`, 1]]);
      const result = explodeBom(
        baseInput({ grossDemand, onHandByLocationItem: onHand })
      );

      // netRequirement = 3 - 1 = 2, so children get 2 × childQty
      expect(result.bomDerivedDemand.get(makeKey(LOC, PER1, P1))).toBe(4);
      expect(result.bomDerivedDemand.get(makeKey(LOC, PER1, L1))).toBe(4);
    });

    it("does not explode BOM when on-hand covers all demand", () => {
      const grossDemand = new Map([[makeKey(LOC, PER1, M), 2]]);
      const onHand = new Map([[`${LOC}-${M}`, 5]]);
      const result = explodeBom(
        baseInput({ grossDemand, onHandByLocationItem: onHand })
      );

      expect(result.bomDerivedDemand.size).toBe(0);
    });
  });

  describe("production supply netting", () => {
    it("reduces net requirement by production order supply", () => {
      const key = makeKey(LOC, PER1, M);
      const grossDemand = new Map([[key, 2]]);
      const jobSupply = new Map([[key, 1]]);
      const result = explodeBom(
        baseInput({
          grossDemand,
          jobSupplyByLocationPeriodItem: jobSupply
        })
      );

      // netRequirement = 2 - 0 (onHand) - 1 (supply) = 1
      expect(result.bomDerivedDemand.get(makeKey(LOC, PER1, P1))).toBe(2);
      expect(result.bomDerivedDemand.get(makeKey(LOC, PER1, L1))).toBe(2);
    });

    it("does not explode BOM when production supply covers all demand", () => {
      const key = makeKey(LOC, PER1, M);
      const grossDemand = new Map([[key, 2]]);
      const jobSupply = new Map([[key, 2]]);
      const result = explodeBom(
        baseInput({
          grossDemand,
          jobSupplyByLocationPeriodItem: jobSupply
        })
      );

      expect(result.bomDerivedDemand.size).toBe(0);
    });

    it("prevents double-counting when jobs exist alongside BOM-derived demand", () => {
      // Sales order creates demand for M, job covers half.
      // Job materials for P1 and L1 are added separately to grossDemand.
      // BOM explosion should only cover the uncovered half.
      const soKey = makeKey(LOC, PER1, M);
      const jobMaterialP1Key = makeKey(LOC, PER1, P1);
      const jobMaterialL1Key = makeKey(LOC, PER1, L1);

      const grossDemand = new Map([
        [soKey, 2], // 2 from sales order
        [jobMaterialP1Key, 2], // 2 P1 from job (1 M × 2 per BOM)
        [jobMaterialL1Key, 2] // 2 L1 from job
      ]);
      const jobSupply = new Map([[soKey, 1]]); // 1 production order for M

      const result = explodeBom(
        baseInput({
          grossDemand,
          jobSupplyByLocationPeriodItem: jobSupply
        })
      );

      // BOM explosion of M: net = 2 - 1 = 1 → P1 += 2, L1 += 2
      // Total P1 grossDemand = 2 (job) + 2 (BOM) = 4
      expect(result.grossDemand.get(jobMaterialP1Key)).toBe(4);
      // bomDerivedDemand only has the BOM-exploded portion
      expect(result.bomDerivedDemand.get(jobMaterialP1Key)).toBe(2);

      // Total L1 grossDemand = 2 (job) + 2 (BOM) = 4
      expect(result.grossDemand.get(jobMaterialL1Key)).toBe(4);

      // L1 cascades to children: grossDemand for L1 = 4, no production supply
      // → P2 = 4 × 2 = 8, P4 = 4 × 2 × 2 = 16
      expect(result.grossDemand.get(makeKey(LOC, PER1, P4))).toBe(16);
    });
  });

  describe("contributor propagation", () => {
    it("propagates sales order contributors through BOM levels", () => {
      const soKey = makeKey(LOC, PER1, M);
      const grossDemand = new Map([[soKey, 1]]);
      const topLevelContributors = new Map<string, DemandContributor[]>([
        [
          soKey,
          [
            {
              sourceType: "Sales Order",
              salesOrderLineId: "sol1",
              parentItemId: M,
              quantity: 1
            }
          ]
        ]
      ]);

      const result = explodeBom(
        baseInput({ grossDemand, topLevelContributors })
      );

      const p1Contributors = result.demandContributors.get(
        makeKey(LOC, PER1, P1)
      );
      expect(p1Contributors).toHaveLength(1);
      expect(p1Contributors![0]).toMatchObject({
        sourceType: "Sales Order",
        salesOrderLineId: "sol1",
        quantity: 2 // scaled by child.quantity
      });
    });

    it("merges BOM-derived and top-level contributors for the same item", () => {
      // L1 has demand from both BOM explosion (SO) and job materials.
      // Contributors from both sources should propagate to L1's children.
      const soKey = makeKey(LOC, PER1, M);
      const l1Key = makeKey(LOC, PER1, L1);

      const grossDemand = new Map([
        [soKey, 1],
        [l1Key, 2] // job material demand
      ]);
      const topLevelContributors = new Map<string, DemandContributor[]>([
        [
          soKey,
          [
            {
              sourceType: "Sales Order",
              salesOrderLineId: "sol1",
              parentItemId: M,
              quantity: 1
            }
          ]
        ],
        [
          l1Key,
          [
            {
              sourceType: "Job Material",
              jobId: "job1",
              parentItemId: L1,
              quantity: 2
            }
          ]
        ]
      ]);

      const result = explodeBom(
        baseInput({ grossDemand, topLevelContributors })
      );

      const p2Contributors = result.demandContributors.get(
        makeKey(LOC, PER1, P2)
      );
      expect(p2Contributors).toBeDefined();

      const sourceTypes = p2Contributors!.map((c) => c.sourceType);
      expect(sourceTypes).toContain("Sales Order");
      expect(sourceTypes).toContain("Job Material");
    });

    it("propagates contributors through inline production items", () => {
      const soKey = makeKey(LOC, PER1, M);
      const grossDemand = new Map([[soKey, 1]]);
      const topLevelContributors = new Map<string, DemandContributor[]>([
        [
          soKey,
          [
            {
              sourceType: "Sales Order",
              salesOrderLineId: "sol1",
              parentItemId: M,
              quantity: 1
            }
          ]
        ]
      ]);

      const result = explodeBom(
        baseInput({ grossDemand, topLevelContributors })
      );

      // P4 is behind P3 (inline production). Contributors should still flow.
      const p4Contributors = result.demandContributors.get(
        makeKey(LOC, PER1, P4)
      );
      expect(p4Contributors).toHaveLength(1);
      expect(p4Contributors![0]).toMatchObject({
        sourceType: "Sales Order",
        salesOrderLineId: "sol1",
        // 1 (SO) × 2 (M→L1) × 2 (L1→P3) × 2 (P3→P4) = 8
        quantity: 8
      });
    });
  });

  describe("Buy and Make coercion", () => {
    it("treats Buy and Make items as Buy for BOM explosion", () => {
      const replenishment = buildReplenishment();
      replenishment.set(P1, "Buy and Make");

      const grossDemand = new Map([[makeKey(LOC, PER1, M), 1]]);
      const result = explodeBom(
        baseInput({ grossDemand, replenishmentSystemByItem: replenishment })
      );

      // P1 is Buy and Make → treated as Buy → gets bomDerivedDemand
      expect(result.bomDerivedDemand.get(makeKey(LOC, PER1, P1))).toBe(2);
    });
  });
});
