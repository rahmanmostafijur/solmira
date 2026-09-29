import { redirect } from 'next/navigation';

// The operations dashboard lands in phase 9; until then the console opens on platform status.
export default function ConsoleHome() {
  redirect('/system/status');
}
