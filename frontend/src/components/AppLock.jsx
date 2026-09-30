import { useEffect, useState } from 'react';
import { Fingerprint, Lock } from 'lucide-react';
import { Button } from './ui/index.js';
import { biometricEnrolment, isNative, setSecureScreen, unlockWithBiometrics } from '../platform/index.js';

const LOCK_AFTER_MS = 5 * 60_000;

/**
 * Android app lock: if the app was in the background for more than a few
 * minutes and biometrics are on, the screen is covered until the owner passes
 * the phone's biometric / screen-lock check. Cancelling signs out (the server
 * session also ends on its own after the session timeout).
 */
export default function AppLock({ onSignOut }) {
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isNative()) return undefined;
    const onResume = (e) => {
      if (biometricEnrolment()?.keyId && (e.detail?.awayMs ?? 0) > LOCK_AFTER_MS) setLocked(true);
    };
    window.addEventListener('achiever:app-resumed', onResume);
    return () => window.removeEventListener('achiever:app-resumed', onResume);
  }, []);

  useEffect(() => {
    if (!locked) return undefined;
    setSecureScreen(true);
    return () => { setSecureScreen(false); };
  }, [locked]);

  if (!locked) return null;
  const unlock = async () => {
    setError(null);
    try {
      await unlockWithBiometrics({ title: 'Unlock ACHIEVER', subtitle: 'Confirm it’s you' });
      setLocked(false);
    } catch (err) {
      setError(err?.code === 'CANCELLED' ? null : 'Could not confirm it’s you. Try again or sign in with your password.');
    }
  };
  return (
    <div className="app-lock" role="dialog" aria-modal="true" aria-labelledby="app-lock-title">
      <Lock size={32} aria-hidden />
      <h2 id="app-lock-title">ACHIEVER is locked</h2>
      <p className="small muted">For your security, confirm it’s you to continue.</p>
      {error && <p className="small" role="alert">{error}</p>}
      <Button icon={Fingerprint} onClick={unlock}>Unlock</Button>
      <Button variant="ghost" onClick={onSignOut}>Sign out and use password</Button>
    </div>
  );
}
