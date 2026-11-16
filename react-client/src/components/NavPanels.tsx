import React, { useEffect, useState } from 'react';
import { t } from '../i18n';
import { AudioGuide, AudioMode } from '../audio/guide';
import { VoiceInfo } from '../audio/voice';
import { Building } from '../nav/building';
import { formatDistance } from '../nav/geometry';
import { NavSnapshot } from '../nav/navigator';
import ManeuverIcon from './ManeuverIcon';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** A panel that slides up from the bottom, with a title and a close button. */
export const Panel = ({ title, onClose, children }: SheetProps) => (
  <div className="panel-scrim" onClick={onClose}>
    <div className="panel" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
      <div className="panel__head">
        <h3>{title}</h3>
        <button type="button" className="panel__close" aria-label={t('Close')} onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {children}
    </div>
  </div>
);

/* ------------------------------------------------------------------ steps */

interface StepsProps {
  building: Building;
  snapshot: NavSnapshot;
  onStepFree?: (on: boolean) => void;
  onClose: () => void;
}

/** The remaining route as a list of steps. */
export const StepsPanel = ({ building, snapshot, onStepFree, onClose }: StepsProps) => {
  const position = snapshot.position;
  const start = snapshot.lastFix ? building.displayName(snapshot.lastFix.node) : t('your position');
  return (
    <Panel title={t('Directions')} onClose={onClose}>
      <p className="panel__lead">
        {t('{distance} · about {min} min to {place}', { distance: formatDistance(snapshot.remaining), min: Math.max(1, Math.round(snapshot.etaSeconds / 60)), place: building.displayName(snapshot.destination) })}
      </p>
      <ol className="route-steps">
        {position && (
          <li className="route-steps__here">
            <span className="route-steps__dot" />
            <div>
              <strong>{t('You are here')}</strong>
              <span>{t('Last marker: {place}', { place: start })}</span>
            </div>
          </li>
        )}
        {snapshot.maneuvers.map((m, i) => (
          <li key={i} className={m.type === 'arrive' ? 'route-steps__arrive' : ''}>
            <span className="route-steps__icon">
              <ManeuverIcon type={m.type} size={22} />
            </span>
            <div>
              <strong>{m.text}</strong>
              {m.detail && <span>{m.detail}</span>}
            </div>
            <em>{m.at < 1 ? t('now') : formatDistance(m.at)}</em>
          </li>
        ))}
      </ol>
      {onStepFree && building.floors.length > 1 && (
        <label className="switch-row">
          <span>
            <strong>{t('Avoid stairs')}</strong>
            <small>{t('Use the lift between floors')}</small>
          </span>
          <input type="checkbox" checked={snapshot.stepFree} onChange={(e) => onStepFree(e.target.checked)} />
          <i aria-hidden="true" />
        </label>
      )}
    </Panel>
  );
};

/* ------------------------------------------------------------------ audio */

interface AudioProps {
  guide: AudioGuide;
  mode: AudioMode;
  onMode: (mode: AudioMode) => void;
  onClose: () => void;
}

const modes = (): Array<{ id: AudioMode; label: string; hint: string }> => [
  { id: 'voice', label: t('Voice'), hint: t('Spoken directions and sounds') },
  { id: 'sounds', label: t('Sounds'), hint: t('Sound cues only') },
  { id: 'off', label: t('Off'), hint: t('Silent') },
];

/** Voice and sound settings. */
export const AudioPanel = ({ guide, mode, onMode, onClose }: AudioProps) => {
  const [voices, setVoices] = useState<VoiceInfo[]>(() => guide.voice.voices());
  const [selected, setSelected] = useState<string>(() => {
    const v = guide.voice.selected();
    return v ? v.uri : '';
  });

  // Browsers load their voice list asynchronously.
  useEffect(() => {
    const refresh = () => {
      setVoices(guide.voice.voices());
      const v = guide.voice.selected();
      setSelected(v ? v.uri : '');
    };
    refresh();
    const synth: any = (window as any).speechSynthesis;
    if (!synth || !synth.addEventListener) return undefined;
    synth.addEventListener('voiceschanged', refresh);
    return () => synth.removeEventListener('voiceschanged', refresh);
  }, [guide]);

  const best = voices.length > 0 ? voices[0].uri : '';
  const MODES = modes();

  return (
    <Panel title={t('Sound')} onClose={onClose}>
      <div className="segmented" role="radiogroup" aria-label={t('Guidance sound')}>
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'is-active' : ''} onClick={() => onMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="panel__hint">{(MODES.find((m) => m.id === mode) || MODES[0]).hint}</p>

      {mode === 'voice' && guide.voice.supported && (
        <>
          <label className="field">
            <span>{t('Voice')}</span>
            <select
              value={selected}
              onChange={(e) => {
                guide.voice.select(e.target.value || null);
                setSelected(e.target.value);
              }}
            >
              {voices.length === 0 && <option value="">{t('Default voice')}</option>}
              {voices.slice(0, 30).map((v) => (
                <option key={v.uri} value={v.uri}>
                  {v.name}
                  {v.uri === best ? ` ${t('(recommended)')}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-nav btn-nav--soft" onClick={() => guide.preview(t('In about ten metres, turn left, at the lobby.'))}>
            {t('Play a sample')}
          </button>
          <p className="panel__note">
            {t("Voices come from your device. The most natural one found is chosen automatically; if it still sounds flat, install an enhanced voice in the system's speech settings and pick it here.")}
          </p>
        </>
      )}
      {mode === 'voice' && !guide.voice.supported && <p className="panel__note">{t('This browser cannot speak; sound cues are still played.')}</p>}
    </Panel>
  );
};

/* -------------------------------------------------------------- fix position */

interface FixProps {
  canScan: boolean;
  onScan: () => void;
  onPick: () => void;
  onClose: () => void;
}

/** "Where am I?" recovery: scan any marker again, or point at the map. */
export const FixPanel = ({ canScan, onScan, onPick, onClose }: FixProps) => (
  <Panel title={t('Fix my position')} onClose={onClose}>
    <p className="panel__lead">{t('One scan is normally enough for the whole trip. If the blue dot has drifted, either of these puts it right again and the route adapts.')}</p>
    {canScan && (
      <button type="button" className="option" onClick={onScan}>
        <span className="option__icon">
          <ManeuverIcon type="scan" size={24} />
        </span>
        <span>
          <strong>{t('Scan a marker')}</strong>
          <small>{t('Point the camera at any QR marker nearby')}</small>
        </span>
      </button>
    )}
    <button type="button" className="option" onClick={onPick}>
      <span className="option__icon">
        <ManeuverIcon type="arrive" size={24} />
      </span>
      <span>
        <strong>{t('Choose on the map')}</strong>
        <small>{t('Tap the marker you are standing at')}</small>
      </span>
    </button>
  </Panel>
);
