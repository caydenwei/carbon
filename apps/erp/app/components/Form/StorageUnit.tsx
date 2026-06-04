// Compatibility shim: keeps the historical `<StorageUnit>` form API but
// renders the hierarchical drill-down picker (Location → tree) underneath.
// All existing callsites continue to work; new code should prefer
// `StorageUnitDrillSelectField` directly.

import type { ComboboxProps } from "@carbon/form";
import { forwardRef, useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import type { getStorageUnitsList } from "~/modules/inventory";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  StorageUnitDrillSelectField,
  type StorageUnitTreeRow
} from "./StorageUnitDrillSelect";

type StorageUnitSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  locationId?: string;
  /** Kept for API compat; the drill picker doesn't display per-item qty. */
  itemId?: string;
  inline?: boolean;
  onChange?: (storageUnit: ListItem | null) => void;
  /**
   * Exclude the given storage unit and every one of its descendants — used
   * by `StorageUnitForm`'s Parent picker so a user cannot pick themselves or
   * a child (which would create a cycle). DB enforces the same invariant
   * via `storage_unit_enforce_no_cycle`.
   */
  excludeDescendantsOf?: string;
};

const StorageUnit = forwardRef<HTMLDivElement, StorageUnitSelectProps>(
  (props, _ref) => {
    const {
      name,
      label,
      inline,
      locationId,
      isReadOnly,
      isOptional,
      excludeDescendantsOf,
      onChange,
      ...rest
    } = props;

    // Field name is required to bind to the form. The original component
    // declared `name` via ComboboxProps (also required).
    if (!name) {
      console.warn("<StorageUnit /> requires a `name` prop.");
      return null;
    }

    return (
      <StorageUnitDrillSelectField
        name={name}
        label={typeof label === "string" ? label : undefined}
        inline={inline}
        helperText={
          typeof rest.helperText === "string" ? rest.helperText : undefined
        }
        locationId={locationId}
        isReadOnly={isReadOnly}
        isOptional={isOptional}
        excludeDescendantsOf={excludeDescendantsOf}
        placeholder={
          typeof rest.placeholder === "string"
            ? rest.placeholder
            : "Select storage unit"
        }
        onChange={(row) => {
          if (!onChange) return;
          onChange(rowToListItem(row));
        }}
      />
    );
  }
);
StorageUnit.displayName = "StorageUnit";

const rowToListItem = (row: StorageUnitTreeRow | null): ListItem | null => {
  if (!row) return null;
  return { id: row.id, name: row.name } as ListItem;
};

export default StorageUnit;

// ---------------------------------------------------------------------------
// useStorageUnits — kept exported because table cells / non-form callsites
// still pull the flat list (with optional per-item qty hints). The drill
// picker has its own tree fetch; this hook stays as the flat fallback.
// ---------------------------------------------------------------------------

export function useStorageUnits(locationId?: string, itemId?: string) {
  const storageUnitsFetcher =
    useFetcher<Awaited<ReturnType<typeof getStorageUnitsList>>>();
  const storageUnitsWithQuantitiesFetcher =
    useFetcher<Awaited<ReturnType<typeof getStorageUnitsList>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (locationId) {
      if (itemId) {
        storageUnitsWithQuantitiesFetcher.load(
          path.to.api.storageUnitsWithQuantities(locationId, itemId)
        );
      }
      storageUnitsFetcher.load(path.to.api.storageUnits(locationId));
    }
  }, [locationId, itemId]);

  const options = useMemo(() => {
    if (itemId && storageUnitsWithQuantitiesFetcher.data?.data) {
      const storageUnitsWithQuantities =
        storageUnitsWithQuantitiesFetcher.data.data;
      const allStorageUnits = storageUnitsFetcher.data?.data ?? [];

      const storageUnitIdsWithQuantities = new Set(
        storageUnitsWithQuantities.map((s: any) => s.id)
      );

      const storageUnitsWithoutQuantities = allStorageUnits.filter(
        (storageUnit: any) => !storageUnitIdsWithQuantities.has(storageUnit.id)
      );

      const combinedStorageUnits = [
        ...storageUnitsWithQuantities.map((c: any) => ({
          value: c.id,
          label: c.name,
          helper: `Qty: ${c.quantity}`
        })),
        ...storageUnitsWithoutQuantities.map((c: any) => ({
          value: c.id,
          label: c.name
        }))
      ];

      return combinedStorageUnits;
    }

    return (
      storageUnitsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.name,
        // Add quantity as helper text if available
        // @ts-expect-error
        ...(c.quantity !== undefined && { helper: `Qty: ${c.quantity}` })
      })) ?? []
    );
  }, [
    storageUnitsFetcher.data,
    storageUnitsWithQuantitiesFetcher.data,
    itemId
  ]);

  return { options, data: storageUnitsFetcher.data };
}
