import { Text } from "@repo/ui"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo } from "react"
import {
  useCacheEconomics,
  useCostBreakdown,
  useCostOverview,
  useCostSeries,
  useModelUsageSeries,
} from "../../../../../domains/cost/cost.collection.ts"
import { useFeatureFlagGate } from "../../../../../domains/feature-flags/feature-flags.collection.ts"
import { useAnalyticsTimeWindow } from "../../../../../domains/projects/use-analytics-time-window.ts"
import { useProjectFirstTraceAt, useProjectLastTraceAt } from "../../../../../domains/traces/traces.collection.ts"
import { ListingLayout as Layout } from "../../../../../layouts/ListingLayout/index.tsx"
import { useParamState } from "../../../../../lib/hooks/useParamState.ts"
import { BreadcrumbText } from "../../../-components/breadcrumb-ui.tsx"
import { TimeFilterDropdown } from "../-components/time-filter-dropdown.tsx"
import { useRouteProject } from "../-route-data.ts"
import { CacheEconomicsPanel } from "./-components/cache-economics-panel.tsx"
import { CostBreakdownPanel } from "./-components/cost-breakdown-panel.tsx"
import { CostConfidenceStrip } from "./-components/cost-confidence-strip.tsx"
import {
  computeDailyAverageMicrocents,
  densifyCostBuckets,
  densifyModelUsageBuckets,
  isCostBreakdownDimension,
  isCostSeriesMetric,
  isModelUsageMeasure,
  pickCostBucketSeconds,
  resolveIncompleteBucketIndex,
} from "./-components/cost-formatters.ts"
import { CostKpiRow } from "./-components/cost-kpi-row.tsx"
import { CostOverTimePanel } from "./-components/cost-over-time-panel.tsx"
import { ModelImpactPanel } from "./-components/model-impact-panel.tsx"
import { ModelUsagePanel } from "./-components/model-usage-panel.tsx"

function CostBreadcrumb() {
  return <BreadcrumbText variant="current">Cost</BreadcrumbText>
}

/** Groups the panels below it. Sits outside the cards, above their own titles. */
function SectionHeading({ children }: { readonly children: string }) {
  return (
    <div className="flex flex-col pt-2">
      <Text.H5M color="foreground">{children}</Text.H5M>
    </div>
  )
}

export const Route = createFileRoute("/_authenticated/projects/$projectSlug/cost/")({
  staticData: {
    breadcrumb: CostBreadcrumb,
  },
  component: CostPageContent,
})

function CostPageContent() {
  const project = useRouteProject()
  const { firstTraceAt, isLoading: firstTraceLoading } = useProjectFirstTraceAt({ projectId: project.id })
  const { lastTraceAt } = useProjectLastTraceAt({ projectId: project.id })
  const tw = useAnalyticsTimeWindow({
    project,
    fromKey: "costTimeFrom",
    toKey: "costTimeTo",
    allTimeLowerBoundIso: firstTraceAt,
    lastActivityIso: lastTraceAt,
  })
  const [metric, setMetric] = useParamState("costMetric", "total", { validate: isCostSeriesMetric })
  const [dimension, setDimension] = useParamState("costDimension", "model", { validate: isCostBreakdownDimension })
  const [usageMeasure, setUsageMeasure] = useParamState("costUsage", "cost", { validate: isModelUsageMeasure })
  const costDashboard = useFeatureFlagGate("costDashboard")

  const listRange = useMemo(
    () => ({ fromIso: tw.listRange.fromIso ?? tw.trendRange.fromIso, toIso: tw.listRange.toIso }),
    [tw.listRange, tw.trendRange],
  )
  const chartRange = useMemo(() => (tw.isAllTime ? tw.trendRange : listRange), [tw.isAllTime, tw.trendRange, listRange])
  const chartBucketSeconds = useMemo(
    () => pickCostBucketSeconds(Date.parse(chartRange.toIso) - Date.parse(chartRange.fromIso)),
    [chartRange],
  )
  const listBucketSeconds = useMemo(
    () => pickCostBucketSeconds(Date.parse(listRange.toIso) - Date.parse(listRange.fromIso)),
    [listRange],
  )

  const enabled = costDashboard.isEnabled
  // Until the first trace settles, All time has no lower bound and `listRange` falls back to the
  // chart window, so the full-history reads wait rather than fetch a narrower window and refetch.
  const listEnabled = enabled && !firstTraceLoading
  const { data: overview, isLoading: overviewLoading } = useCostOverview({
    projectId: project.id,
    range: listRange,
    enabled: listEnabled,
  })
  const { data: series = [], isLoading: seriesLoading } = useCostSeries({
    projectId: project.id,
    range: chartRange,
    metric,
    bucketSeconds: chartBucketSeconds,
    enabled,
  })
  // Feeds the Avg per day KPI, so it follows the KPI window, not the chart's. Outside All time the
  // two windows are the same key as the series above, so the metric toggle costs no second request.
  const { data: totalSeries = [], isLoading: totalSeriesLoading } = useCostSeries({
    projectId: project.id,
    range: listRange,
    metric: "total",
    bucketSeconds: listBucketSeconds,
    enabled: listEnabled,
  })
  const { data: modelUsage, isLoading: modelUsageLoading } = useModelUsageSeries({
    projectId: project.id,
    range: chartRange,
    bucketSeconds: chartBucketSeconds,
    enabled,
  })
  const { data: cacheEconomics, isLoading: cacheEconomicsLoading } = useCacheEconomics({
    projectId: project.id,
    range: listRange,
    enabled: listEnabled,
  })
  const { data: breakdown, isLoading: breakdownLoading } = useCostBreakdown({
    projectId: project.id,
    range: listRange,
    dimension,
    enabled: listEnabled,
  })
  // The impact panel is about models whichever dimension the table below is showing.
  // Same query key as above while the Model tab is selected, so that costs no request.
  const { data: modelBreakdown, isLoading: modelBreakdownLoading } = useCostBreakdown({
    projectId: project.id,
    range: listRange,
    dimension: "model",
    enabled: listEnabled,
  })

  const buckets = useMemo(
    () => densifyCostBuckets({ buckets: series, ...chartRange, bucketSeconds: chartBucketSeconds }),
    [series, chartRange, chartBucketSeconds],
  )
  const provisionalIndex = useMemo(
    () =>
      resolveIncompleteBucketIndex({
        buckets,
        bucketSeconds: chartBucketSeconds,
        toIso: chartRange.toIso,
        nowMs: Date.now(),
      }),
    [buckets, chartBucketSeconds, chartRange.toIso],
  )
  const denseModelUsage = useMemo(
    () =>
      modelUsage
        ? {
            ...modelUsage,
            buckets: densifyModelUsageBuckets({
              buckets: modelUsage.buckets,
              ...chartRange,
              bucketSeconds: chartBucketSeconds,
            }),
          }
        : undefined,
    [modelUsage, chartRange, chartBucketSeconds],
  )
  const modelUsageProvisionalIndex = useMemo(
    () =>
      resolveIncompleteBucketIndex({
        buckets: denseModelUsage?.buckets ?? [],
        bucketSeconds: chartBucketSeconds,
        toIso: chartRange.toIso,
        nowMs: Date.now(),
      }),
    [denseModelUsage, chartBucketSeconds, chartRange.toIso],
  )
  const dailyAverageMicrocents = useMemo(
    () =>
      computeDailyAverageMicrocents({
        buckets: totalSeries,
        bucketSeconds: listBucketSeconds,
        ...listRange,
        nowMs: Date.now(),
      }),
    [totalSeries, listBucketSeconds, listRange],
  )

  if (costDashboard.isLoading || !enabled) {
    return (
      <Layout>
        <div className="flex min-h-[240px] items-center justify-center px-6">
          {costDashboard.isLoading ? null : (
            <Text.H5 color="foregroundMuted">Cost is not available for this organization yet.</Text.H5>
          )}
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <Layout.Header
        title="Cost dashboard"
        description="Optimize your spending"
        actions={
          <TimeFilterDropdown
            {...(tw.pickerStartFrom ? { startTimeFrom: tw.pickerStartFrom } : {})}
            {...(tw.pickerStartTo ? { startTimeTo: tw.pickerStartTo } : {})}
            onChange={tw.onTimeChange}
          />
        }
      />
      <div className="flex flex-col gap-4 px-6 pb-6">
        <CostKpiRow
          overview={overview}
          dailyAverageMicrocents={dailyAverageMicrocents}
          bucketSeconds={listBucketSeconds}
          isLoading={firstTraceLoading || overviewLoading || totalSeriesLoading}
        />
        <CostOverTimePanel
          buckets={buckets}
          metric={metric}
          onMetricChange={setMetric}
          bucketSeconds={chartBucketSeconds}
          provisionalIndex={provisionalIndex}
          rangeFromIso={chartRange.fromIso}
          rangeToIso={chartRange.toIso}
          isAllTime={tw.isAllTime}
          isLoading={seriesLoading}
        />
        <SectionHeading>Model</SectionHeading>
        {/* The two model questions side by side: how spend moves, and who it goes to. */}
        <div className="flex flex-col gap-4 xl:flex-row">
          <div className="flex min-w-0 flex-1 flex-col">
            <ModelUsagePanel
              series={denseModelUsage}
              measure={usageMeasure}
              onMeasureChange={setUsageMeasure}
              bucketSeconds={chartBucketSeconds}
              provisionalIndex={modelUsageProvisionalIndex}
              rangeFromIso={chartRange.fromIso}
              rangeToIso={chartRange.toIso}
              isAllTime={tw.isAllTime}
              isLoading={modelUsageLoading}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <ModelImpactPanel
              breakdown={modelBreakdown}
              rangeFromIso={listRange.fromIso}
              rangeToIso={listRange.toIso}
              isAllTime={tw.isAllTime}
              isLoading={firstTraceLoading || modelBreakdownLoading}
            />
          </div>
        </div>
        <SectionHeading>Cache</SectionHeading>
        <CacheEconomicsPanel economics={cacheEconomics} isLoading={cacheEconomicsLoading} />
        <CostBreakdownPanel
          breakdown={breakdown}
          dimension={dimension}
          onDimensionChange={setDimension}
          isLoading={firstTraceLoading || breakdownLoading}
        />
        <CostConfidenceStrip confidence={overview?.confidence} isLoading={firstTraceLoading || overviewLoading} />
      </div>
    </Layout>
  )
}
