import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { buildDepreciationLines } from "~/modules/accounting/accounting.utils";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const { depreciationRunId } = params;
  if (!depreciationRunId) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(null, "Missing depreciation run ID"))
    );
  }

  // Get the source run to find its period
  const sourceRun = await client
    .from("depreciationRun")
    .select("periodEnd, status")
    .eq("id", depreciationRunId)
    .single();

  if (sourceRun.error) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(sourceRun.error, "Failed to load source run"))
    );
  }

  if (sourceRun.data.status !== "Posted") {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(null, "Only posted runs can be repeated"))
    );
  }

  const periodEnd = sourceRun.data.periodEnd;

  // Find all assets already covered by runs for this period
  const runsForPeriod = await client
    .from("depreciationRun")
    .select("id")
    .eq("companyId", companyId)
    .eq("periodEnd", periodEnd);

  const runIdsForPeriod = (runsForPeriod.data ?? []).map((r) => r.id);

  let coveredAssetIds = new Set<string>();
  if (runIdsForPeriod.length > 0) {
    const existingLines = await client
      .from("depreciationRunLine")
      .select("fixedAssetId")
      .in("depreciationRunId", runIdsForPeriod);

    coveredAssetIds = new Set(
      (existingLines.data ?? []).map((l) => l.fixedAssetId)
    );
  }

  const companySettings = await client
    .from("companySettings")
    .select("assetTaxDepreciationEnabled")
    .eq("id", companyId)
    .single();

  const taxEnabled =
    (companySettings.data as any)?.assetTaxDepreciationEnabled ?? false;

  // Get all active assets
  const assets = await client
    .from("fixedAsset")
    .select("*")
    .eq("companyId", companyId)
    .eq("status", "Active");

  if (assets.error) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(assets.error, "Failed to fetch assets"))
    );
  }

  // Filter to only uncovered assets
  const uncoveredAssets = (assets.data ?? []).filter(
    (a) => !coveredAssetIds.has(a.id)
  );

  if (uncoveredAssets.length === 0) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(null, "All active assets are already covered for this period")
      )
    );
  }

  // Use last posted run before this period for calculation baseline
  const lastPostedRun = await client
    .from("depreciationRun")
    .select("periodEnd")
    .eq("companyId", companyId)
    .eq("status", "Posted")
    .lt("periodEnd", periodEnd)
    .order("periodEnd", { ascending: false })
    .limit(1);

  const lastPostedPeriodEnd =
    lastPostedRun.data && lastPostedRun.data.length > 0
      ? lastPostedRun.data[0].periodEnd
      : null;

  const usageLogs = await client
    .from("fixedAssetUsageLog")
    .select("fixedAssetId, unitsProduced")
    .eq("periodEnd", periodEnd);

  const usageMap = new Map(
    (usageLogs.data ?? []).map((u) => [u.fixedAssetId, u])
  );

  const lines = buildDepreciationLines(
    uncoveredAssets.map((a) => ({
      ...a,
      accumulatedTaxDepreciation: Number(
        (a as any).accumulatedTaxDepreciation ?? 0
      ),
      taxDepreciationMethod: (a as any).taxDepreciationMethod ?? null,
      taxUsefulLifeMonths: (a as any).taxUsefulLifeMonths ?? null,
      taxResidualValuePercent: (a as any).taxResidualValuePercent ?? null,
      macrsPropertyClass: (a as any).macrsPropertyClass ?? null,
      macrsConvention: (a as any).macrsConvention ?? null,
      bonusDepreciationPercent: (a as any).bonusDepreciationPercent ?? null
    })),
    periodEnd,
    lastPostedPeriodEnd,
    taxEnabled,
    usageMap
  );

  if (lines.length === 0) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(null, "No depreciation to calculate for uncovered assets")
      )
    );
  }

  const nextSequence = await getNextSequence(
    client,
    "depreciationRun",
    companyId
  );
  if (nextSequence.error) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(nextSequence.error, "Failed to generate run ID")
      )
    );
  }

  const run = await client
    .from("depreciationRun")
    .insert({
      depreciationRunId: nextSequence.data,
      periodEnd,
      status: "Draft",
      companyId,
      createdBy: userId
    })
    .select("id")
    .single();

  if (run.error) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(run.error, "Failed to create repeat depreciation run")
      )
    );
  }

  const lineInserts = lines.map((line) => ({
    depreciationRunId: run.data.id,
    fixedAssetId: line.fixedAssetId,
    amount: line.amount,
    taxAmount: line.taxAmount,
    companyId
  }));

  const lineResult = await client
    .from("depreciationRunLine")
    .insert(lineInserts);

  if (lineResult.error) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(lineResult.error, "Failed to create run lines")
      )
    );
  }

  throw redirect(
    path.to.depreciationRun(run.data.id),
    await flash(request, success("Repeat depreciation run created"))
  );
}
