import { useEffect } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { UserAvatar } from '../ui/index.js';
import { usePreferences } from '../../contexts/PreferencesContext.jsx';

/** Short, polite ring generated with Web Audio (no audio files to fetch). */
function useRing(active) {
  useEffect(() => {
    if (!active || typeof window.AudioContext === 'undefined') return undefined;
    let ctx;
    try {
      ctx = new AudioContext();
    } catch {
      return undefined;
    }
    const beep = () => {
      if (ctx.state === 'suspended') return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.65);
    };
    beep();
    const t = setInterval(beep, 2000);
    return () => {
      clearInterval(t);
      ctx.close().catch(() => {});
    };
  }, [active]);
}

export default function IncomingCall({ call, onAccept, onReject, pending }) {
  const { prefs } = usePreferences();
  useRing(prefs.messages.callRingtone !== false); // Settings > Messages > Call ringtone
  const video = call.callType === 'video';
  return (
    <div className="incoming-call" role="alertdialog" aria-labelledby="incoming-title">
      <UserAvatar name={call.callerName} size={52} />
      <div className="grow">
        <p id="incoming-title" style={{ fontWeight: 600 }}>
          {call.callerName || 'Someone'}
        </p>
        <p className="small" style={{ color: '#b9c6dc' }}>
          Incoming {call.scope === 'group' ? 'group ' : ''}
          {video ? 'video' : 'voice'} call
        </p>
      </div>
      <button type="button" className="call-btn danger" onClick={onReject} aria-label="Decline call">
        <PhoneOff size={20} />
      </button>
      <button type="button" className="call-btn success" onClick={onAccept} disabled={pending} aria-label="Accept call">
        {video ? <Video size={20} /> : <Phone size={20} />}
      </button>
    </div>
  );
}
