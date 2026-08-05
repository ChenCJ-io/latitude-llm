import { WASTED_SPEND_MIN_SAMPLE_TRACES } from "@domain/spans"
import { Icon, Skeleton, Text, Tooltip } from "@repo/ui"
import { formatCount, formatPercentage } from "@repo/utils"
import { Link } from "@tanstack/react-router"
import { ArrowRightIcon, InfoIcon } from "lucide-react"
import type { WastedSpendRecord } from "../../../../../../domains/cost/cost.functions.ts"
import { rollupCostDisplay } from "../../../../../../domains/spans/cost-display.ts"
import { ChartHeader } from "../../-components/chart-header.tsx"
import { serializeFilters } from "../../-components/trace-page-state.ts"
import { formatSignedPrice, microcentsToUsd, shareOf } from "./cost-formatters.ts"
import { OTHER_SERIES_COLOR } from "./cost-series-colors.ts"

// Named after the money, not the mechanism: a failure with no `error.type` attribute is a
// row the user has to be able to act on, and "unknown" reads as a value the model returned.
const UNLABELLED_REASON = "No error type recorded"

const WASTED_BAR_COLOR = "hsl(0 70% 55%)"

interface ReasonRow {
  readonly key: string
  readonly label: string
  readonly traces: number
  readonly costMicrocents: number
  readonly isRemainder: boolean
}

function buildReasonRows(record: WastedSpendRecord): readonly ReasonRow[] {
  const rows: ReasonRow[] = record.reasons.map((reason) => ({
    key: reason.errorType || "__unlabelled__",
    label: reason.errorType || UNLABELLED_REASON,
    traces: reason.traces,
    costMicrocents: reason.costMicrocents,
    isRemainder: false,
  }))
  const other = record.otherReasons
  if (!other) return rows
  return [
    ...rows,
    {
      key: "__other__",
      label: other.typeCount === 1 ? "1 other reason" : `${other.typeCount} other reasons`,
      traces: other.traces,
      costMicrocents: other.costMicrocents,
      isRemainder: true,
    },
  ]
}

/**
 * The share of the panel's own total, never of the window: these bars answer "what was the
 * money wasted on", and a row's share of total spend would be a second, smaller-looking
 * number for the same fact.
 */
function ReasonBar({ share, isRemainder }: { readonly share: number; readonly isRemainder: boolean }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-sm bg-muted">
      <div
        className="h-full min-w-[2px] rounded-sm"
        style={{
          width: `${Math.max(0, Math.min(100, share * 100))}%`,
          backgroundColor: isRemainder ? OTHER_SERIES_COLOR : WASTED_BAR_COLOR,
        }}
      />
    </div>
  )
}

/**
 * Money that bought nothing: what this window spent on traces that errored.
 *
 * Whole-trace by decision, stated in the headline tooltip — a failed call usually records
 * no usage of its own, so charging only the failed span would report ~$0 for exactly the
 * traces that wasted the most. Nothing else on the page shows a per-span framing of the
 * same claim; the two would not reconcile.
 */
export function WastedSpendPanel({
  record,
  projectSlug,
  rangeFromIso,
  rangeToIso,
  isAllTime,
  isLoading,
}: {
  readonly record: WastedSpendRecord | undefined
  readonly projectSlug: string
  readonly rangeFromIso: string
  readonly rangeToIso: string
  readonly isAllTime: boolean
  readonly isLoading: boolean
}) {
  const rows = record ? buildReasonRows(record) : []
  const wasted = rollupCostDisplay({
    costTotalMicrocents: record?.erroredCostMicrocents ?? 0,
    unpricedSpanCount: record?.erroredUnpricedCalls ?? 0,
    tokensTotal: record?.erroredTokens ?? 0,
  })
  // The same Status filter the traces list applies, so the drill-down returns the very
  // traces this panel counted rather than a differently-defined subset.
  const erroredTracesSearch = {
    tab: "traces",
    filters: serializeFilters({
      status: [{ op: "in", value: ["error"] }],
      startTime: [
        { op: "gte", value: rangeFromIso },
        { op: "lte", value: rangeToIso },
      ],
    }),
  }

  return (
    <div className="flex flex-1 flex-col rounded-lg border border-border bg-background">
      <ChartHeader
        title="Wasted spend"
        fromIso={rangeFromIso}
        toIso={rangeToIso}
        isAllTime={isAllTime}
        showWindow={isAllTime}
      />
      {isLoading || !record ? (
        <div className="flex flex-col gap-3 p-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : record.erroredTraces === 0 ? (
        <div className="flex w-full min-h-[120px] items-center justify-center p-3">
          <Text.H6 color="foregroundMuted">
            {record.tracesWithUsage === 0 ? "No spend recorded in this time window" : "No spend on traces that errored"}
          </Text.H6>
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-3">
          <div className="flex flex-row flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-row items-center gap-1.5">
                <Text.H2 color="foreground" className="tabular-nums">
                  {wasted.label}
                </Text.H2>
                <Tooltip
                  asChild
                  trigger={
                    <span className="inline-flex cursor-default">
                      <Icon icon={InfoIcon} size="sm" color="foregroundMuted" />
                    </span>
                  }
                >
                  {`Everything these traces spent, not only their failed steps. A failed call usually records no usage of its own — the money went on the steps that succeeded and whose output was then discarded. A trace counts as errored when at least one of its spans failed, the same definition the traces list uses.${wasted.note ? ` ${wasted.note}` : ""}`}
                </Tooltip>
              </div>
              <Text.H6 color="foregroundMuted">
                {`${formatCount(record.erroredTraces)} of ${formatCount(record.tracesWithUsage)} traces with usage errored`}
              </Text.H6>
            </div>
            <div className="flex flex-col items-end gap-1">
              {record.wastedShare === null ? (
                <Tooltip
                  asChild
                  trigger={
                    <span className="inline-flex cursor-default">
                      <Text.H6 color="foregroundMuted">no share yet</Text.H6>
                    </span>
                  }
                >
                  {record.erroredCostMicrocents <= 0
                    ? "These traces errored without recording any spend, so there is a count to act on but no share of the money."
                    : `A share needs at least ${WASTED_SPEND_MIN_SAMPLE_TRACES} traces with usage — over ${formatCount(record.tracesWithUsage)}, one failure moves the figure by tens of points.`}
                </Tooltip>
              ) : (
                <Text.H4 color="foreground" className="tabular-nums">
                  {`${formatPercentage(record.wastedShare)} of spend`}
                </Text.H4>
              )}
              <Link
                to="/projects/$projectSlug"
                params={{ projectSlug }}
                search={erroredTracesSearch}
                className="inline-flex flex-row items-center gap-1"
              >
                <Text.H6 color="primary">View errored traces</Text.H6>
                <Icon icon={ArrowRightIcon} size="sm" color="primary" />
              </Link>
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <div key={row.key} className="flex flex-row items-center gap-3">
                <div className="flex w-40 shrink-0 flex-col">
                  <Text.H6 color={row.isRemainder ? "foregroundMuted" : "foreground"} ellipsis noWrap>
                    {row.label}
                  </Text.H6>
                </div>
                <ReasonBar
                  share={shareOf(row.costMicrocents, record.erroredCostMicrocents) ?? 0}
                  isRemainder={row.isRemainder}
                />
                <div className="flex w-16 shrink-0 justify-end">
                  <Text.H6 color="foregroundMuted" noWrap className="tabular-nums">
                    {formatSignedPrice(microcentsToUsd(row.costMicrocents))}
                  </Text.H6>
                </div>
                <div className="flex w-20 shrink-0 justify-end">
                  <Text.H6 color="foregroundMuted" noWrap className="tabular-nums">
                    {`${formatCount(row.traces)} ${row.traces === 1 ? "trace" : "traces"}`}
                  </Text.H6>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
