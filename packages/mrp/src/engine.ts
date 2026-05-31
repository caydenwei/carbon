export type MethodType =
  | "Make to Order"
  | "Pull from Inventory"
  | "Purchase to Order";
export type ReplenishmentSystem = "Buy" | "Make" | "Buy and Make";

export type BomChild = {
  itemId: string;
  quantity: number;
  methodType: MethodType;
};

export type DemandPeriod = {
  id: string;
  startDate: string;
  endDate: string;
};

export type DemandContributor =
  | {
      sourceType: "Job Material";
      jobId: string;
      parentItemId: string;
      quantity: number;
    }
  | {
      sourceType: "Sales Order";
      salesOrderLineId: string;
      parentItemId: string;
      quantity: number;
    }
  | {
      sourceType: "Demand Projection";
      demandProjectionId: string;
      parentItemId: string;
      quantity: number;
    };

export type BomExplosionInput = {
  grossDemand: Map<string, number>;
  bomByItem: Map<string, BomChild[]>;
  replenishmentSystemByItem: Map<string, ReplenishmentSystem>;
  leadTimeByItem: Map<string, number>;
  periods: DemandPeriod[];
  onHandByLocationItem: Map<string, number>;
  jobSupplyByLocationPeriodItem: Map<string, number>;
  topLevelContributors: Map<string, DemandContributor[]>;
};

export type BomExplosionOutput = {
  grossDemand: Map<string, number>;
  bomDerivedDemand: Map<string, number>;
  demandContributors: Map<string, DemandContributor[]>;
};

export function splitKey(key: string): [string, string, string] {
  const parts = key.split("-");
  return [parts[0]!, parts[1]!, parts.slice(2).join("-")];
}

export function makeKey(
  locationId: string,
  periodId: string,
  itemId: string
): string {
  return `${locationId}-${periodId}-${itemId}`;
}

function effectiveReplenishment(
  repSys: ReplenishmentSystem | undefined
): "Buy" | "Make" | undefined {
  return repSys === "Buy and Make"
    ? "Buy"
    : (repSys as "Buy" | "Make" | undefined);
}

export function computeLowLevelCodes(
  bomByItem: Map<string, BomChild[]>
): Map<string, number> {
  const llc = new Map<string, number>();

  function assignLevel(
    itemId: string,
    level: number,
    visited: Set<string>
  ): void {
    if (visited.has(itemId)) return;
    visited.add(itemId);

    const currentLLC = llc.get(itemId) ?? -1;
    if (level > currentLLC) {
      llc.set(itemId, level);
    }

    const children = bomByItem.get(itemId) ?? [];
    for (const child of children) {
      assignLevel(child.itemId, level + 1, new Set(visited));
    }
  }

  for (const itemId of bomByItem.keys()) {
    assignLevel(itemId, 0, new Set());
  }

  return llc;
}

export function explodeBom(input: BomExplosionInput): BomExplosionOutput {
  const {
    bomByItem,
    replenishmentSystemByItem,
    leadTimeByItem,
    periods,
    topLevelContributors
  } = input;

  const grossDemand = new Map(input.grossDemand);
  const onHandByLocationItem = new Map(input.onHandByLocationItem);
  const jobSupply = input.jobSupplyByLocationPeriodItem;

  const bomDerivedDemand = new Map<string, number>();
  const demandContributors = new Map<string, DemandContributor[]>();

  const llc = computeLowLevelCodes(bomByItem);
  const maxLevel = llc.size > 0 ? Math.max(...llc.values()) : 0;

  for (let level = 0; level <= maxLevel; level++) {
    const keysAtLevel: string[] = [];
    for (const [key, qty] of grossDemand) {
      if (qty <= 0) continue;
      const [, , itemId] = splitKey(key);
      if ((llc.get(itemId) ?? 0) === level) {
        keysAtLevel.push(key);
      }
    }

    for (const key of keysAtLevel) {
      const grossQty = grossDemand.get(key) ?? 0;
      if (grossQty <= 0) continue;

      const [locationId, periodId, itemId] = splitKey(key);
      const effRepSys = effectiveReplenishment(
        replenishmentSystemByItem.get(itemId)
      );

      const invKey = `${locationId}-${itemId}`;
      const onHand = onHandByLocationItem.get(invKey) ?? 0;
      const productionSupply = jobSupply.get(key) ?? 0;
      const netRequirement = Math.max(
        0,
        grossQty - Math.max(0, onHand) - productionSupply
      );

      if (onHand > 0) {
        onHandByLocationItem.set(invKey, Math.max(0, onHand - grossQty));
      }

      if (netRequirement > 0 && effRepSys === "Make") {
        const children = bomByItem.get(itemId) ?? [];
        for (const child of children) {
          const childEffRepSys = effectiveReplenishment(
            replenishmentSystemByItem.get(child.itemId)
          );

          const isInlineProduction =
            child.methodType === "Make to Order" && childEffRepSys === "Make";

          const childQty = child.quantity * netRequirement;
          const childLeadTimeDays = leadTimeByItem.get(child.itemId) ?? 7;
          const childLeadTimeWeeks = Math.ceil(childLeadTimeDays / 7);

          const currentPeriodIndex = periods.findIndex(
            (p) => p.id === periodId
          );
          const targetPeriodIndex = Math.max(
            0,
            currentPeriodIndex - childLeadTimeWeeks
          );
          const targetPeriod = periods[targetPeriodIndex];

          if (targetPeriod) {
            const childKey = makeKey(locationId, targetPeriod.id, child.itemId);
            grossDemand.set(
              childKey,
              (grossDemand.get(childKey) ?? 0) + childQty
            );
            if (!isInlineProduction) {
              bomDerivedDemand.set(
                childKey,
                (bomDerivedDemand.get(childKey) ?? 0) + childQty
              );
            }

            const parentContributors = [
              ...(demandContributors.get(key) ?? []),
              ...(topLevelContributors.get(key) ?? [])
            ];
            if (parentContributors.length > 0) {
              const childContributors = demandContributors.get(childKey) ?? [];
              for (const pc of parentContributors) {
                childContributors.push({
                  ...pc,
                  quantity: pc.quantity * child.quantity
                });
              }
              demandContributors.set(childKey, childContributors);
            }
          }
        }
      }
    }
  }

  return { grossDemand, bomDerivedDemand, demandContributors };
}
