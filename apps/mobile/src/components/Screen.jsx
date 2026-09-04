import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { styles } from './ui';
import { colors } from '../theme';

// The mockup's phone chrome: a thin teal "fiber trace" rule under the status
// bar, then a top bar, then scrolling content.
//
// The trace is static here. In the mockup it is a 3.2s infinite gradient sweep;
// on a phone that would cost a permanent Reanimated worklet running whether or
// not anyone is looking at it, which is not a trade worth making for decoration.
export function Screen({ eyebrow, title, sub, children, right, refreshControl, scroll = true }) {
  const insets = useSafeAreaInsets();

  const header = (
    <>
      <View style={[styles.trace, { marginTop: insets.top }]} />
      {title ? (
        <View style={styles.topbar}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
              <Text style={styles.h1}>{title}</Text>
              {sub ? <Text style={styles.sub}>{sub}</Text> : null}
            </View>
            {right}
          </View>
        </View>
      ) : null}
    </>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {header}
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }]}>{children}</View>
      )}
    </View>
  );
}
