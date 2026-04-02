import { UserRole } from '@wpt/types';

export default function Home() {
  return (
    <main>
      <h1>WPT IoT System</h1>
      <p>Status: Running</p>
      <p>Roles: {Object.values(UserRole).join(', ')}</p>
    </main>
  );
}
