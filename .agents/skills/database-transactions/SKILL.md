---
name: database-transactions
description: Use when writing service functions that perform multi-row database writes, bulk updates, reordering, or any operation that must succeed or fail atomically. Triggers on Kysely transactions, sortOrder updates, bulk inserts/updates, multi-table writes, and service functions with array/loop writes.
---

# Database Transactions in Carbon

## When to use Kysely transactions

When a service function writes to **multiple rows** — whether by mapping over an array, looping, or chaining several inserts/updates that must succeed or fail together — wrap the writes in a Postgres transaction via **Kysely**, not a `Promise.all` of independent Supabase calls.

**Why:** every `client.from(...).update(...)` is a separate HTTP roundtrip to PostgREST. With `Promise.all`, three of five rows can commit and the rest fail, leaving the data in a half-applied state with no rollback. Kysely opens one PG transaction, runs every write inside it, and rolls everything back on any error.

**Use transactions when:**
- Bulk reorder / sortOrder updates across N rows.
- Writes that span multiple tables and need to be all-or-nothing (e.g. parent + child rows, denormalized counters).
- Anything where partial application would be a real bug, not a cosmetic glitch.

**Don't use transactions when:**
- A single write (already atomic).
- Reads only — keep using the Supabase client (`client.from(...).select(...)`), Kysely has no auth/RLS context.
- Throwaway/idempotent fan-out where partial failure is fine and retry is cheap.

## The Carbon transaction pattern

Service function takes `db: Kysely<KyselyDatabase>` and wraps writes in `db.transaction().execute(async (trx) => { ... })`. The route handler injects the connection via `getDatabaseClient()` from `~/services/database.server`. Real precedents to copy from: `items.service.ts -> upsertPickMethodWithShelfLife`, `production.service.ts -> updateProcedureStepOrder` (older `Promise.all` version — do not mirror), and all of the `update<Entity>LineOrder` functions across `purchasing`, `sales`, `invoicing` services.

### Service function example

```ts
// apps/erp/app/modules/purchasing/purchasing.service.ts
import type { Kysely, KyselyDatabase } from "@carbon/database/client";

export async function updatePurchaseOrderLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("purchaseOrderLine")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}
```

### Route handler example

```ts
// apps/erp/app/routes/x+/purchase-order+/$orderId.line-order.tsx
import { getDatabaseClient } from "~/services/database.server";
import { updatePurchaseOrderLineOrder } from "~/modules/purchasing";

export async function action({ request, params }: ActionFunctionArgs) {
  const { userId } = await requirePermissions(request, { update: "purchasing" });
  // ... build `updates` from formData ...
  try {
    await updatePurchaseOrderLineOrder(getDatabaseClient(), updates);
  } catch (err) {
    return data(
      { success: false },
      await flash(request, error(err, "Failed to update sort order"))
    );
  }
  return { success: true };
}
```

## Key notes

- **`Kysely<KyselyDatabase>` is the first arg by convention.** The route passes `getDatabaseClient()`.
- Kysely throws on rollback — wrap the call in `try/catch`, don't expect an `{ error }` return.
- Kysely auto-quotes reserved column names (e.g. `order`), so `.set({ order: sortOrder })` is safe.
- Kysely uses a connection pool and the Postgres role — **it bypasses RLS.** Enforce auth at the route via `requirePermissions(...)`, and when in doubt scope queries by `companyId` inside the transaction.
