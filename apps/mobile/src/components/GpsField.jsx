import { useState } from 'react';
import { Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Field } from './fields';
import { Badge, SecondaryButton, styles } from './ui';
import { colors, fonts } from '../theme';

/**
 * Drops a pin on where the tech is standing.
 *
 * This is the most important field on the premises form, because out here it is
 * the only one that reliably works: the villages have no street names and no
 * house numbers, so an address is a description and a coordinate is a fact.
 *
 * `value` is { lat, lng, accuracy, capturedAt } or null. The parent owns it.
 *
 * Two things this deliberately does NOT do:
 *
 *   - watch the position. A continuous watch drains a battery the tech needs
 *     for the rest of the day, and the app only ever wants one fix, taken when
 *     they say so.
 *   - block the form. A fix can be refused, or never arrive under tree cover,
 *     and a premises can still be saved on a landmark alone. Losing the whole
 *     record because the sky was cloudy would be the worse failure.
 */

// Under about 20 m is good enough to walk back to the right compound. Over
// 50 m and you are pointing at the neighbours, so the number is shown with a
// verdict rather than left for the tech to interpret.
const GOOD_ACCURACY_M = 20;
const POOR_ACCURACY_M = 50;

function accuracyVerdict(accuracy) {
  if (accuracy === null || accuracy === undefined) return null;
  if (accuracy <= GOOD_ACCURACY_M) return { variant: 'ok', text: 'Good fix' };
  if (accuracy <= POOR_ACCURACY_M) return { variant: 'low', text: 'Rough fix' };
  return { variant: 'danger', text: 'Too rough' };
}

export function GpsField({ value, onChange, label = 'GPS location', hint }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function capture() {
    setError(null);
    setBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError(
          'Location permission was refused. You can still save this premises with a landmark, ' +
            'or allow location in your phone settings and try again.'
        );
        return;
      }

      // Highest accuracy the handset will give: this pin is what somebody uses
      // to find the compound again, possibly months later and possibly not the
      // tech who took it.
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });

      onChange({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy:
          position.coords.accuracy === null || position.coords.accuracy === undefined
            ? null
            : Math.round(position.coords.accuracy),
        capturedAt: new Date(position.timestamp).toISOString(),
      });
    } catch (err) {
      // Almost always location services switched off at the OS level, which the
      // tech can fix and which is worth saying rather than "something failed".
      setError(
        err?.message?.includes('disabled') || err?.code === 'E_LOCATION_SERVICES_DISABLED'
          ? 'Location is switched off on this phone. Turn it on and tap again.'
          : 'Could not get a fix. Step outside, away from walls, and tap again.'
      );
    } finally {
      setBusy(false);
    }
  }

  const verdict = accuracyVerdict(value?.accuracy);

  return (
    <Field label={label} hint={error ? undefined : hint} error={error}>
      {value ? (
        <View
          style={[
            styles.input,
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.text1 }}>
              {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
            </Text>
            <Text style={[styles.serialStatus, { marginTop: 2 }]}>
              {value.accuracy === null
                ? 'accuracy not reported'
                : `accurate to about ${value.accuracy} m`}
            </Text>
          </View>
          {verdict ? <Badge variant={verdict.variant}>{verdict.text}</Badge> : null}
        </View>
      ) : null}

      <SecondaryButton onPress={capture} disabled={busy}>
        {busy ? 'Getting a fix…' : value ? 'Take the fix again' : 'Use my location'}
      </SecondaryButton>

      {/* A rough fix is worth keeping and worth re-taking, and saying which is
        * more use than a number on its own. */}
      {value && verdict?.variant !== 'ok' ? (
        <Text style={styles.hint}>
          Step into the open and tap again — a fix this rough can point at the wrong compound.
        </Text>
      ) : null}
    </Field>
  );
}

// The captured pin, as the API's premises fields. Kept next to the component so
// the shape is defined once for every screen that submits one.
export function gpsFields(value) {
  if (!value) return {};
  return {
    gps_lat: value.lat,
    gps_lng: value.lng,
    gps_accuracy_m: value.accuracy ?? undefined,
    gps_captured_at: value.capturedAt,
  };
}

// The reverse, for a screen editing a premises that already has a fix.
export function gpsFromPremises(premises) {
  if (!premises || premises.gps_lat === null || premises.gps_lat === undefined) return null;
  return {
    lat: Number(premises.gps_lat),
    lng: Number(premises.gps_lng),
    accuracy: premises.gps_accuracy_m === null ? null : Number(premises.gps_accuracy_m),
    capturedAt: premises.gps_captured_at,
  };
}
