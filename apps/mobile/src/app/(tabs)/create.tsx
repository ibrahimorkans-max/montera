import { Redirect } from 'expo-router';

// The centre tab button opens the invoice builder directly; this route only exists for deep links.
export default function Create() {
  return <Redirect href="/invoice/new" />;
}
