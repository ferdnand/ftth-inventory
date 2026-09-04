// Chart palette and mark specs, validated against the card surface #171F2E.
//
//   5-slot categorical: lightness band PASS · chroma PASS · contrast all >= 3:1
//   teal ordinal ramp:  monotone PASS · adjacent lightness step PASS
//
// DO NOT substitute the brand teal #2DD4BF into `series`. It measures OKLCH
// L 0.785, above the 0.67 ceiling for a dark-mode categorical band, and fails
// the lightness check. It is correct for buttons, the active tab, hero numbers
// and accent text (8.87:1 on surface) — just not as a series fill. #17A398
// reads as the same teal family and is in band.
//
// The series order is the CVD mechanism: adjacent slots were chosen to stay
// distinguishable under deuteranopia and protanopia. Reordering them breaks
// that, so add to the end rather than inserting.
export const chart = {
  surface: '#171F2E',
  grid: '#28334A',
  axis: '#28334A',
  axisText: '#8B96A8', // --text-2, not --text-3 (which measures 2.77:1)

  series: ['#17A398', '#D95926', '#9085E9', '#C98500', '#D55181'],
  seriesSingle: '#17A398',
  ordinalTeal: ['#5EEAD4', '#2DD4BF', '#17A398', '#0F766E', '#115E59'],

  status: {
    good: '#34D399',
    warning: '#F5A623',
    serious: '#EC835A',
    critical: '#EF4565',
  },

  barMaxSize: 24,
  barRadius: 4,
  lineWidth: 2,
  dotRadius: 4,
};

export const seriesColor = (index) => chart.series[index % chart.series.length];

// Fixed colours for the five removal reasons, so a reason keeps the same slot
// across every chart and every date range.
export const REMOVAL_REASON_COLORS = {
  faulty: chart.series[1],
  upgrade: chart.series[0],
  customer_cancelled: chart.series[2],
  theft: chart.series[4],
  other: chart.series[3],
};

export const axisProps = {
  stroke: chart.axis,
  tick: { fill: chart.axisText, fontSize: 11 },
  tickLine: false,
};
