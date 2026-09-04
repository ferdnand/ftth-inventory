import { useRouter } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { EmptyState, PrimaryButton } from '../src/components/ui';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <Screen title="Not found">
      <EmptyState title="That screen doesn’t exist">
        The link you followed points somewhere this app doesn’t have.
      </EmptyState>
      <PrimaryButton onPress={() => router.replace('/(tabs)/stock')}>Go to my stock</PrimaryButton>
    </Screen>
  );
}
