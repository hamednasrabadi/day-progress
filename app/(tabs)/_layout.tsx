/**
 * Tab bar layout.
 *
 * Responsibilities:
 *   - Define the five tabs and their icons/labels.
 *   - Set the shared tab bar visual style.
 *
 * What does NOT belong here:
 *   - Alarm handling  →  root _layout.tsx
 *   - Notification setup  →  root _layout.tsx
 *   - Any business logic  →  individual screen files
 */

import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#09090B',
          borderTopWidth: 1,
          borderTopColor: '#27272A',
          height: 110,
          paddingBottom: 60,
          paddingTop: 5,
        },
        tabBarActiveTintColor: '#FAFAFA',
        tabBarInactiveTintColor: '#52525B',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
      }}
    >
      {/* Order: Notes → Tasks → Timeline (anchor/centre) → Habits → Challenges */}

      <Tabs.Screen
        name="notes"
        options={{
          title: 'Notes',
          tabBarIcon: ({ color }) => <Feather name="file-text" size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="todo"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color }) => <Feather name="check-square" size={24} color={color} />,
        }}
      />

      {/* Centre tab — the anchor / default route */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Timeline',
          tabBarIcon: ({ color }) => <Feather name="grid" size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="habits"
        options={{
          title: 'Habits',
          tabBarIcon: ({ color }) => <Feather name="repeat" size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="challenges"
        options={{
          title: 'Challenges',
          tabBarIcon: ({ color }) => <Feather name="award" size={24} color={color} />,
        }}
      />

      {/* Art Tab — dev-only sandbox for visual experiments. Hidden in production. */}
      <Tabs.Screen
        name="art"
        options={{
          title: 'Art',
          tabBarIcon: ({ color }) => <Feather name="feather" size={24} color={color} />,
          href: __DEV__ ? undefined : null,
        }}
      />
    </Tabs>
  );
}