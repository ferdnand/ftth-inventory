// Chart palette and mark specs, re-picked for the white card surface.
//
// The categorical slots and teal ramp were re-picked by eye for the light theme;
// the contrast checks that validated the dark palette have not been re-run.
//
// DO NOT substitute the brand teal #2DD4BF into `series`: it is too pale on
// white to read as a bar or line. #0F8F86 is the same teal family and holds up.
//
// The series order is the CVD mechanism: adjacent slots were chosen to stay
// distinguishable under deuteranopia and protanopia. Reordering them breaks
// that, so add to the end rather than inserting.
export const chart = {
  surface: '#FFFFFF',
  grid: '#E3E8F0',
  axis: '#D5DCE8',
  axisText: '#55607A', // --text-2, not --text-3 (decorative only)

  series: ['#0F8F86', '#D95926', '#7C6FE0', '#B87400', '#D55181'],
  seriesSingle: '#0F8F86',
  ordinalTeal: ['#99F6E4', '#2DD4BF', '#14B8A6', '#0F766E', '#134E4A'],

  status: {
    good: '#047857',
    warning: '#B45309',
    serious: '#C2410C',
    critical: '#C81E45',
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
