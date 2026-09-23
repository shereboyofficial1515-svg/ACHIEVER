import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { Maximize2, Mic, MicOff, Minimize2, PhoneOff, Video, VideoOff, Volume2 } from 'lucide-react';
import { UserAvatar } from '../ui/index.js';
import { duration } from '../../utils/format.js';

function snapshot(room) {
  if (!room) return [];
  const list = [room.localParticipant, ...room.remoteParticipants.values()];
  return list.map((p) => {
    const cam = p.getTrackPublication(Track.Source.Camera);
    let avatarUrl;
    try {
      avatarUrl = p.metadata ? JSON.parse(p.metadata).avatarUrl : undefined;
    } catch {
      avatarUrl = undefined;
    }
    return {
      identity: p.identity,
      name: p.name || 'Participant',
      avatarUrl,
      isLocal: p === room.localParticipant,
      speaking: p.isSpeaking,
      micOn: p.isMicrophoneEnabled,
      videoTrack: cam && !cam.isMuted ? cam.track : null,
    };
  });
}

function VideoTile({ p, large }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !p.videoTrack) return undefined;
    p.videoTrack.attach(el);
    return () => p.videoTrack.detach(el);
  }, [p.videoTrack]);
  return (
    <div className={`tile ${p.speaking ? 'speaking' : ''} ${large ? 'large' : ''}`}>
      {p.videoTrack ? (
        <video ref={ref} autoPlay playsInline muted={p.isLocal} className={p.isLocal ? 'mirror' : ''} />
      ) : (
        <div className="tile-avatar">
          <UserAvatar name={p.name} src={p.avatarUrl} size={large ? 96 : 64} />
        </div>
      )}
      <span className="tile-name">
        {!p.micOn && <MicOff size={12} aria-label="muted" />} {p.isLocal ? 'You' : p.name}
      </span>
    </div>
  );
}

function CallView({ session, onLeave, onEnd, refreshToken, audioHost }) {
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [state, setState] = useState('connecting');
  const [people, setPeople] = useState([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(session.call.callType === 'video');
  const [elapsed, setElapsed] = useState(0);
  const [minimised, setMinimised] = useState(false);
  const [outputs, setOutputs] = useState([]);
  const [error, setError] = useState(null);
  const connectedAt = useRef(null);

  const refresh = useCallback(() => setPeople(snapshot(room)), [room]);

  useEffect(() => {
    let cancelled = false;
    const onTrack = (track) => {
      if (track.kind === Track.Kind.Audio && audioHost.current) {
        const el = track.attach();
        audioHost.current.appendChild(el);
      }
      refresh();
    };
    const offTrack = (track) => {
      track.detach().forEach((el) => el.remove());
      refresh();
    };
    room
      .on(RoomEvent.TrackSubscribed, onTrack)
      .on(RoomEvent.TrackUnsubscribed, offTrack)
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.Reconnecting, () => setState('reconnecting'))
      .on(RoomEvent.Reconnected, () => setState('connected'))
      .on(RoomEvent.ConnectionStateChanged, (s) => {
        if (s === ConnectionState.Connected) setState('connected');
      })
      .on(RoomEvent.Disconnected, () => {
        if (!cancelled) setState('disconnected');
      });

    (async () => {
      try {
        await room.connect(session.url, session.token);
        if (cancelled) return;
        connectedAt.current = Date.now();
        setState('connected');
        await room.localParticipant.setMicrophoneEnabled(true).catch(() => setMicOn(false));
        if (session.call.callType === 'video') await room.localParticipant.setCameraEnabled(true).catch(() => setCamOn(false));
        refresh();
        const devices = await Room.getLocalDevices('audiooutput').catch(() => []);
        setOutputs(devices);
      } catch (err) {
        // A token may have expired during a long ring; fetch a fresh one once.
        try {
          const fresh = await refreshToken();
          if (fresh && !cancelled) {
            await room.connect(fresh.url, fresh.token);
            setState('connected');
            await room.localParticipant.setMicrophoneEnabled(true);
            refresh();
            return;
          }
        } catch {
          /* fall through */
        }
        setError(err?.message || 'Could not connect to the call');
        setState('failed');
      }
    })();

    return () => {
      cancelled = true;
      room.removeAllListeners();
      room.disconnect();
    };
  }, [room, session.url, session.token, session.call.callType, refresh, refreshToken]);

  useEffect(() => {
    if (state !== 'connected') return undefined;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - (connectedAt.current || Date.now())) / 1000)), 1000);
    return () => clearInterval(t);
  }, [state]);

  const toggleMic = async () => {
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next).catch(() => {});
    setMicOn(next);
    refresh();
  };
  const toggleCam = async () => {
    const next = !camOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCamOn(next);
    } catch {
      setError('Camera is unavailable or permission was denied');
    }
    refresh();
  };
  const switchOutput = async (deviceId) => {
    await room.switchActiveDevice('audiooutput', deviceId).catch(() => setError('Could not switch speaker'));
  };

  const remotes = people.filter((p) => !p.isLocal);
  const waiting = session.call.scope === 'direct' && remotes.length === 0;
  const statusText =
    state === 'connecting' ? 'Connecting...'
      : state === 'reconnecting' ? 'Reconnecting...'
        : state === 'failed' ? 'Connection failed'
          : state === 'disconnected' ? 'Disconnected'
            : waiting ? 'Calling...'
              : duration(elapsed);

  if (minimised) {
    return (
      <div className="call-mini" role="region" aria-label="Ongoing call">
        <span className="small">{statusText}</span>
        <button type="button" className="call-btn small" onClick={() => setMinimised(false)} aria-label="Expand call">
          <Maximize2 size={16} />
        </button>
        <button type="button" className="call-btn danger small" onClick={onLeave} aria-label="Leave call">
          <PhoneOff size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="call-overlay" role="dialog" aria-label="Call">
      <header className="call-top">
        <div>
          <p style={{ fontWeight: 600 }}>{session.call.scope === 'group' ? 'Group call' : remotes[0]?.name || 'Call'}</p>
          <p className="small" style={{ color: '#b9c6dc' }} aria-live="polite">
            {statusText}
            {session.call.scope === 'group' && state === 'connected' ? ` · ${people.length} in call` : ''}
          </p>
        </div>
        <button type="button" className="call-btn small" onClick={() => setMinimised(true)} aria-label="Minimise call">
          <Minimize2 size={16} />
        </button>
      </header>

      {error && <p className="call-error" role="alert">{error}</p>}

      <div className={`call-grid count-${Math.min(people.length, 6)}`}>
        {(remotes.length ? people : people.filter((p) => p.isLocal)).map((p) => (
          <VideoTile key={p.identity} p={p} large={people.length <= 2 && !p.isLocal} />
        ))}
      </div>

      <footer className="call-controls">
        <button type="button" className={`call-btn ${micOn ? '' : 'off'}`} onClick={toggleMic} aria-pressed={!micOn} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}>
          {micOn ? <Mic size={22} /> : <MicOff size={22} />}
        </button>
        <button type="button" className={`call-btn ${camOn ? '' : 'off'}`} onClick={toggleCam} aria-pressed={!camOn} aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}>
          {camOn ? <Video size={22} /> : <VideoOff size={22} />}
        </button>
        {outputs.length > 1 && (
          <label className="call-output">
            <Volume2 size={18} aria-hidden />
            <span className="sr-only">Speaker</span>
            <select onChange={(e) => switchOutput(e.target.value)} defaultValue="">
              <option value="" disabled>
                Speaker
              </option>
              {outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Audio output'}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="call-btn danger" onClick={session.call.scope === 'direct' ? onEnd : onLeave} aria-label="Leave call">
          <PhoneOff size={22} />
        </button>
        {session.call.scope === 'group' && (
          <button type="button" className="btn btn-sm btn-danger" onClick={onEnd}>
            End for all
          </button>
        )}
      </footer>
    </div>
  );
}

/** The hidden audio host lives outside the view so remote audio survives minimise/expand. */
export default function CallInterface(props) {
  const audioHost = useRef(null);
  return (
    <>
      <div ref={audioHost} hidden />
      <CallView {...props} audioHost={audioHost} />
    </>
  );
}
