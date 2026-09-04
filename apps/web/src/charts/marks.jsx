import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chart, axisProps, seriesColor } from './chartTheme';
import { ChartTooltip } from './ChartFrame';

// Grid is a solid hairline, horizontal only, never dashed.
const Grid = ({ vertical = false }) => (
  <CartesianGrid stroke={chart.grid} vertical={vertical} horizontal={!vertical} />
);

/**
 * Trend over time: a single 2px line.
 *
 * Deliberately not direct-labelling every point — one endpoint marker and a
 * crosshair tooltip. A number on every point turns a trend into a table.
 */
export function TrendLine({ data, xKey, yKey, yName, height = 240, formatX }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
        <Grid />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={formatX} />
        <YAxis {...axisProps} allowDecimals={false} />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ stroke: chart.grid }}
          labelFormatter={formatX}
        />
        <Line
          type="monotone"
          dataKey={yKey}
          name={yName}
          stroke={chart.seriesSingle}
          strokeWidth={chart.lineWidth}
          strokeLinecap="round"
          dot={false}
          // A visible end marker with a surface-coloured ring, so the latest
          // value reads as "here we are now".
          activeDot={{ r: chart.dotRadius + 2, stroke: chart.surface, strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Magnitude across nominal categories: horizontal bars, ONE hue for every bar.
 *
 * No legend (a single series is named by the title), horizontal because item
 * names are long, and explicitly not a darker-where-bigger colour ramp — that
 * would double-encode what the bar length already says.
 */
export function RankedBar({ data, labelKey, valueKey, valueName, height, formatValue }) {
  const rowHeight = 30;
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(data.length * rowHeight + 40, 160)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
        <Grid vertical />
        <XAxis type="number" {...axisProps} />
        <YAxis
          type="category"
          dataKey={labelKey}
          width={168}
          {...axisProps}
          tick={{ ...axisProps.tick, width: 160 }}
        />
        <Tooltip content={<ChartTooltip formatValue={formatValue} />} cursor={{ fill: chart.grid, fillOpacity: 0.3 }} />
        <Bar
          dataKey={valueKey}
          name={valueName}
          fill={chart.seriesSingle}
          maxBarSize={chart.barMaxSize}
          radius={[0, chart.barRadius, chart.barRadius, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Part-to-whole across periods, or across one nominal axis.
 *
 * `stackKeys` map to the validated 5-slot categorical order. Each segment is
 * outlined in the surface colour, which renders as a 2px gap between segments
 * rather than a contrasting border.
 */
export function StackedBar({
  data,
  xKey,
  stackKeys,
  colorFor,
  height = 260,
  layout = 'horizontal',
  formatX,
  formatValue,
}) {
  const isVertical = layout === 'vertical';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={layout}
        margin={{ top: 8, right: 16, bottom: 4, left: isVertical ? 8 : -12 }}
      >
        <Grid vertical={isVertical} />
        {isVertical ? (
          <>
            <XAxis type="number" {...axisProps} />
            <YAxis type="category" dataKey={xKey} width={168} {...axisProps} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} tickFormatter={formatX} />
            <YAxis {...axisProps} allowDecimals={false} />
          </>
        )}
        <Tooltip
          content={<ChartTooltip formatValue={formatValue} />}
          cursor={{ fill: chart.grid, fillOpacity: 0.3 }}
          labelFormatter={formatX}
        />
        {stackKeys.map((key, index) => (
          <Bar
            key={key.value}
            dataKey={key.value}
            name={key.label}
            stackId="a"
            fill={colorFor ? colorFor(key.value, index) : seriesColor(index)}
            maxBarSize={chart.barMaxSize}
            stroke={chart.surface}
            strokeWidth={2}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * A bar chart whose bars each carry their own severity colour. Used only where
 * severity is the point (low stock), and always alongside a text label so the
 * colour is never the sole signal.
 */
export function SeverityBar({ data, labelKey, valueKey, colorKey, height, formatValue }) {
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(data.length * 30 + 40, 160)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
        <Grid vertical />
        <XAxis type="number" {...axisProps} />
        <YAxis type="category" dataKey={labelKey} width={168} {...axisProps} />
        <Tooltip content={<ChartTooltip formatValue={formatValue} />} cursor={{ fill: chart.grid, fillOpacity: 0.3 }} />
        <Bar dataKey={valueKey} maxBarSize={chart.barMaxSize} radius={[0, chart.barRadius, chart.barRadius, 0]}>
          {data.map((row, index) => (
            <Cell key={index} fill={row[colorKey]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
