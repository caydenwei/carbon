import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import type { Transaction } from "kysely";
import { getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import type { DB } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

interface TriggerReworkRequest {
  jobId: string;
  triggeredAtJobOperationId: string;
  targetJobOperationId: string;
  reason: string;
  quantity: number;
  trackedEntityId?: string;
  companyId: string;
  userId: string;
}

/**
 * Finds the shortest path from targetOperationId to triggeredAtOperationId
 * by walking backwards through the DAG from triggeredAt.
 * Returns operations in forward order (target → ... → triggeredAt).
 */
async function findReworkPath(
  trx: Transaction<DB>,
  jobId: string,
  targetOperationId: string,
  triggeredAtOperationId: string
): Promise<string[]> {
  const dependencies = await trx
    .selectFrom("jobOperationDependency")
    .select(["operationId", "dependsOnId"])
    .where("jobId", "=", jobId)
    .execute();

  // Build adjacency list: operationId → [operations it depends on]
  const dependsOn = new Map<string, string[]>();
  for (const dep of dependencies) {
    const existing = dependsOn.get(dep.operationId) ?? [];
    existing.push(dep.dependsOnId);
    dependsOn.set(dep.operationId, existing);
  }

  // BFS backwards from triggeredAt to find target
  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [triggeredAtOperationId];
  visited.add(triggeredAtOperationId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetOperationId) break;

    for (const predecessor of dependsOn.get(current) ?? []) {
      if (!visited.has(predecessor)) {
        visited.add(predecessor);
        parent.set(predecessor, current);
        queue.push(predecessor);
      }
    }
  }

  if (!visited.has(targetOperationId)) {
    throw new Error(
      `No path found from target operation ${targetOperationId} to triggered operation ${triggeredAtOperationId}`
    );
  }

  // Trace path from target back to triggeredAt (forward order)
  const path: string[] = [];
  let current = targetOperationId;
  while (current !== triggeredAtOperationId) {
    path.push(current);
    current = parent.get(current)!;
  }
  path.push(triggeredAtOperationId);

  return path;
}

async function triggerRework(
  trx: Transaction<DB>,
  body: TriggerReworkRequest
) {
  const {
    jobId,
    triggeredAtJobOperationId,
    targetJobOperationId,
    reason,
    quantity,
    trackedEntityId,
    companyId,
    userId,
  } = body;

  // 1. Find the path of operations to clone
  const operationPath = await findReworkPath(
    trx,
    jobId,
    targetJobOperationId,
    triggeredAtJobOperationId
  );

  console.info(
    `📋 Rework path: ${operationPath.length} operations to clone`
  );

  // 2. Create the rework record
  // @ts-expect-error - rework table not in generated types until migration is applied
  const [rework] = await trx
    .insertInto("rework")
    .values({
      jobId,
      triggeredAtJobOperationId,
      targetJobOperationId,
      reason,
      quantity,
      trackedEntityId: trackedEntityId ?? null,
      requestedById: userId,
      companyId,
    })
    .returning(["id"])
    .execute();

  // 3. Fetch the source operations to clone
  const sourceOperations = await trx
    .selectFrom("jobOperation")
    .selectAll()
    .where("id", "in", operationPath)
    .execute();

  // Sort by path order
  const pathIndex = new Map(operationPath.map((id, i) => [id, i]));
  sourceOperations.sort(
    (a, b) => (pathIndex.get(a.id) ?? 0) - (pathIndex.get(b.id) ?? 0)
  );

  // 4. Clone operations
  const clonedOperationIds: string[] = [];
  const sourceToCloneMap = new Map<string, string>();

  for (const sourceOp of sourceOperations) {
    const [clonedOp] = await trx
      .insertInto("jobOperation")
      .values({
        jobId: sourceOp.jobId,
        jobMakeMethodId: sourceOp.jobMakeMethodId,
        order: sourceOp.order,
        processId: sourceOp.processId,
        workCenterId: sourceOp.workCenterId,
        description: sourceOp.description,
        setupTime: sourceOp.setupTime,
        setupUnit: sourceOp.setupUnit,
        laborTime: sourceOp.laborTime,
        laborUnit: sourceOp.laborUnit,
        machineTime: sourceOp.machineTime,
        machineUnit: sourceOp.machineUnit,
        operationOrder: sourceOp.operationOrder,
        laborRate: sourceOp.laborRate,
        overheadRate: sourceOp.overheadRate,
        machineRate: sourceOp.machineRate,
        operationType: sourceOp.operationType,
        operationMinimumCost: sourceOp.operationMinimumCost,
        operationLeadTime: sourceOp.operationLeadTime,
        operationUnitCost: sourceOp.operationUnitCost,
        operationSupplierProcessId: sourceOp.operationSupplierProcessId,
        workInstruction: sourceOp.workInstruction,
        procedureId: sourceOp.procedureId,
        operationQuantity: quantity,
        tags: sourceOp.tags,
        companyId,
        createdBy: userId,
        // @ts-expect-error - reworkId not in generated types until migration is applied
        reworkId: rework.id,
        status: "Waiting",
        customFields: sourceOp.customFields,
      })
      .returning(["id"])
      .execute();

    clonedOperationIds.push(clonedOp.id);
    sourceToCloneMap.set(sourceOp.id, clonedOp.id);
  }

  console.info(`🔧 Cloned ${clonedOperationIds.length} operations`);

  // 5. Clone steps, tools, and parameters for each operation
  for (const sourceOp of sourceOperations) {
    const cloneId = sourceToCloneMap.get(sourceOp.id)!;

    // Clone steps
    const steps = await trx
      .selectFrom("jobOperationStep")
      .selectAll()
      .where("operationId", "=", sourceOp.id)
      .execute();

    if (steps.length > 0) {
      await trx
        .insertInto("jobOperationStep")
        .values(
          steps.map(
            ({
              id: _id,
              operationId: _opId,
              createdAt: _ca,
              updatedAt: _ua,
              updatedBy: _ub,
              ...step
            }) => ({
              ...step,
              operationId: cloneId,
              createdBy: userId,
            })
          )
        )
        .execute();
    }

    // Clone tools
    const tools = await trx
      .selectFrom("jobOperationTool")
      .selectAll()
      .where("operationId", "=", sourceOp.id)
      .execute();

    if (tools.length > 0) {
      await trx
        .insertInto("jobOperationTool")
        .values(
          tools.map((tool) => ({
            toolId: tool.toolId,
            quantity: tool.quantity,
            operationId: cloneId,
            companyId,
            createdBy: userId,
          }))
        )
        .execute();
    }

    // Clone parameters
    const params = await trx
      .selectFrom("jobOperationParameter")
      .selectAll()
      .where("operationId", "=", sourceOp.id)
      .execute();

    if (params.length > 0) {
      await trx
        .insertInto("jobOperationParameter")
        .values(
          params.map((param) => ({
            key: param.key,
            value: param.value,
            operationId: cloneId,
            companyId,
            createdBy: userId,
          }))
        )
        .execute();
    }
  }

  // 6. Wire the rework operations into the DAG

  // 6a. First rework op depends on the trigger operation
  await trx
    .insertInto("jobOperationDependency")
    .values({
      operationId: clonedOperationIds[0],
      dependsOnId: triggeredAtJobOperationId,
      jobId,
      companyId,
    })
    .execute();

  // 6b. Each subsequent rework op depends on the previous
  for (let i = 1; i < clonedOperationIds.length; i++) {
    await trx
      .insertInto("jobOperationDependency")
      .values({
        operationId: clonedOperationIds[i],
        dependsOnId: clonedOperationIds[i - 1],
        jobId,
        companyId,
      })
      .execute();
  }

  // 6c. Rewire downstream operations
  const downstreamDeps = await trx
    .selectFrom("jobOperationDependency")
    .select(["operationId", "dependsOnId"])
    .where("dependsOnId", "=", triggeredAtJobOperationId)
    .where("operationId", "not in", clonedOperationIds)
    .execute();

  const lastReworkOpId = clonedOperationIds[clonedOperationIds.length - 1];

  for (const dep of downstreamDeps) {
    await trx
      .deleteFrom("jobOperationDependency")
      .where("operationId", "=", dep.operationId)
      .where("dependsOnId", "=", triggeredAtJobOperationId)
      .execute();

    await trx
      .insertInto("jobOperationDependency")
      .values({
        operationId: dep.operationId,
        dependsOnId: lastReworkOpId,
        jobId,
        companyId,
      })
      .execute();
  }

  console.info(`🔗 DAG wired with ${downstreamDeps.length} downstream deps rewired`);

  // 7. Record a productionQuantity entry for the rework
  await trx
    .insertInto("productionQuantity")
    .values({
      jobOperationId: triggeredAtJobOperationId,
      type: "Rework",
      quantity,
      companyId,
      createdBy: userId,
    })
    .execute();

  return {
    reworkId: rework.id,
    clonedOperationIds,
    operationsCloned: clonedOperationIds.length,
  };
}

// Main handler
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: TriggerReworkRequest = await req.json();

    console.info(
      `🔰 Starting rework for job ${body.jobId}: go back to ${body.targetJobOperationId} from ${body.triggeredAtJobOperationId}`
    );

    const result = await db.transaction().execute(async (trx) => {
      return await triggerRework(trx, body);
    });

    // Trigger reschedule for date/priority recalculation (after transaction)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      await fetch(`${supabaseUrl}/functions/v1/reschedule`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          jobId: body.jobId,
          companyId: body.companyId,
          userId: body.userId,
        }),
      });
    } catch (err) {
      console.error("Failed to trigger reschedule after rework:", err);
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(
      `❌ Rework failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
