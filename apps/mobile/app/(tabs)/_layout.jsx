import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { colors, fonts } from '../../src/theme';

// Three tabs: Jobs / Stock / History. The mockup's bar said Stock / Install /
// History, from when an install was the thing being recorded. A job is, now —
// it owns the unit fitted, the materials, the labour and the costs — so it
// leads, and it is where the app opens.
//
// Glyphs rather than an icon library: three characters is not worth a
// dependency, and they render identically on both platforms.
const GLYPHS = { stock: '▦', jobs: '⌖', history: '⟲' };

function TabIcon({ name, color }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontSize: 18, lineHeight: 22 }}>{GLYPHS[name]}</Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.text3,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: fonts.display, fontSize: 10.5 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'Jobs',
          tabBarIcon: ({ color }) => <TabIcon name="jobs" color={color} />,
        }}
      />
      <Tabs.Screen
        name="stock"
        options={{
          title: 'Stock',
          tabBarIcon: ({ color }) => <TabIcon name="stock" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => <TabIcon name="history" color={color} />,
        }}
      />
    </Tabs>
  );
}
