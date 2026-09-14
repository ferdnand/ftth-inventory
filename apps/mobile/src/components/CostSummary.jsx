import { Text, View } from 'react-native';
import { Card, styles } from './ui';
import { formatAmount, formatMoney } from '../lib/money';
import { colors, fonts } from '../theme';

/**
 * What the job has cost so far.
 *
 * Four buckets, not one number, because they are four different kinds of spend
 * and because the tech can only do anything about three of them.
 *
 * `unpriced_lines` gets its own line, in amber, whenever it is non-zero. A
 * total with unpriced lines behind it is a floor and not a cost, and showing
 * 1,200 as if it were the answer — when it is the price of the one item
 * somebody got round to pricing — is worse than showing no number at all.
 */
const BUCKETS = [
  ['Materials', 'materials_total'],
  ['Labour', 'labour_total'],
  ['Other costs', 'expenses_total'],
  ['Hardware', 'hardware_total'],
];

export function CostSummary({ costs }) {
  if (!costs) return null;

  return (
    <Card>
      {BUCKETS.map(([label, key]) => (
        <View
          key={key}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 6,
          }}
        >
          <Text style={styles.serialStatus}>{label}</Text>
          <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.text1 }}>
            {formatAmount(costs[key])}
          </Text>
        </View>
      ))}

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: colors.border,
          marginTop: 6,
          paddingTop: 10,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <Text style={styles.itemName}>Total</Text>
        <Text style={{ fontFamily: fonts.monoSemi, fontSize: 17, color: colors.teal }}>
          {formatMoney(costs.total)}
        </Text>
      </View>

      {costs.unpriced_lines > 0 ? (
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 11,
            color: colors.amber,
            marginTop: 8,
            lineHeight: 16,
          }}
        >
          {costs.unpriced_lines} {costs.unpriced_lines === 1 ? 'line has' : 'lines have'} no price
          set, so the real total is higher than this. The warehouse sets prices in the catalog.
        </Text>
      ) : null}
    </Card>
  );
}
