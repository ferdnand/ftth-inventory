import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { colors, fonts } from '../../src/theme';

// Three tabs, exactly as the mockup's bottom bar: Stock / Install / History.
// Glyphs rather than an icon library — three characters is not worth a
// dependency, and they render identically on both platforms.
const GLYPHS = { stock: '▦', install: '⌖', history: '⟲' };

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
        name="stock"
        options={{
          title: 'Stock',
          tabBarIcon: ({ color }) => <TabIcon name="stock" color={color} />,
        }}
      />
      <Tabs.Screen
        name="install"
        options={{
          title: 'Install',
          tabBarIcon: ({ color }) => <TabIcon name="install" color={color} />,
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
