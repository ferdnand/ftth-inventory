import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { styles } from './ui';
import { colors, fonts } from '../theme';

export function Field({ label, hint, error, children }) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      {children}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function TextField({ label, hint, error, value, onChangeText, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} hint={hint} error={error}>
      <TextInput
        style={[styles.input, focused && styles.inputFocused]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.text3}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...rest}
      />
    </Field>
  );
}

// A read-only field. Used for the MAC address on the replace screen: the system
// already holds it against the serial, so making the tech retype it would only
// create a way to get it wrong.
export function ReadOnlyField({ label, value, hint }) {
  return (
    <Field label={label} hint={hint}>
      <View style={[styles.input, { backgroundColor: colors.surface }]}>
        <Text style={{ fontFamily: fonts.mono, fontSize: 13.5, color: value ? colors.text1 : colors.text3 }}>
          {value ?? 'not recorded'}
        </Text>
      </View>
    </Field>
  );
}

export function SearchBar({ value, onChangeText, placeholder, autoFocus }) {
  return (
    <View style={styles.searchBar}>
      {/* Inline glyph rather than an icon dependency. */}
      <Text style={{ color: colors.text2, fontSize: 14 }}>⌕</Text>
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType="search"
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear search">
          <Text style={{ color: colors.text2, fontSize: 16 }}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
