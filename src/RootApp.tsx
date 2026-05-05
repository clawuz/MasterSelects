import { lazy, Suspense, type CSSProperties } from 'react';
import { LandingPage } from './marketing/LandingPage';
import type { EntryExperience } from './routing/entryExperience';

const EditorApp = lazy(() => import('./App'));

interface RootAppProps {
  initialExperience: EntryExperience;
}

const loadingShellStyle: CSSProperties = {
  alignItems: 'center',
  background: 'linear-gradient(135deg, #101215 0%, #1c222a 100%)',
  color: '#f5f7fa',
  display: 'flex',
  fontFamily: '"Segoe UI", sans-serif',
  fontSize: '16px',
  height: '100%',
  justifyContent: 'center',
  width: '100%',
};

export function RootApp({ initialExperience }: RootAppProps) {
  if (initialExperience === 'landing') {
    return <LandingPage />;
  }

  return (
    <Suspense fallback={<div style={loadingShellStyle}>Opening MasterSelects...</div>}>
      <EditorApp />
    </Suspense>
  );
}

export default RootApp;
