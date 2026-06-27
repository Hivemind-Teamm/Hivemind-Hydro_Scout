'use client';

/**
 * OtwHazardPanel.tsx
 * Shows hazard warnings for non-operational hydrants along the active route corridor.
 * Appears automatically when OTW mode is active and hazards are detected.
 */

import { type Hydrant } from '../data/hydrants';

interface OtwHazardPanelProps {
  hazards: Hydrant[];
  onSelectHydrant: (hydrant: Hydrant) => void;
}

const HAZARD_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  out:     { label: 'Out of Service', color: '#9aa0a6', bg: 'rgba(154,160,166,0.12)', icon: '🚫' },
  reduced: { label: 'Reduced Pressure', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '⚠️' },
};

export default function OtwHazardPanel({ hazards, onSelectHydrant }: OtwHazardPanelProps) {
  if (hazards.length === 0) return null;

  const outCount     = hazards.filter((h) => h.status === 'out').length;
  const reducedCount = hazards.filter((h) => h.status === 'reduced').length;

  return (
    <div style={{
      width: '100%',
      pointerEvents: 'auto',
      background: 'rgba(17,24,39,0.96)',
      border: '1px solid rgba(245,158,11,0.4)',
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,158,11,0.1)',
      overflow: 'hidden',
      backdropFilter: 'blur(12px)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid rgba(75,85,99,0.4)',
        background: 'rgba(245,158,11,0.08)',
      }}>
        <span style={{ fontSize: 14 }}>⚠️</span>
        <div style={{ flex: 1 }}>
          <p style={{ color: '#f59e0b', fontWeight: 700, fontSize: 12, margin: 0 }}>
            Route Hazards Detected
          </p>
          <p style={{ color: '#6b7280', fontSize: 10, margin: '1px 0 0' }}>
            {outCount > 0 && `${outCount} out of service`}
            {outCount > 0 && reducedCount > 0 && ' · '}
            {reducedCount > 0 && `${reducedCount} reduced pressure`}
            {' '}near your route
          </p>
        </div>
      </div>

      {/* Hazard list */}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 220, overflowY: 'auto' }}>
        {hazards.map((h) => {
          const m = HAZARD_META[h.status] ?? HAZARD_META.reduced;
          return (
            <li key={h.id} style={{ borderBottom: '1px solid rgba(55,65,81,0.4)' }}>
              <button
                onClick={() => onSelectHydrant(h)}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 14px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(55,65,81,0.4)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                {/* Status dot */}
                <div style={{
                  flexShrink: 0, marginTop: 2,
                  width: 8, height: 8, borderRadius: '50%',
                  background: m.color,
                  boxShadow: `0 0 6px ${m.color}`,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: '#fff', fontSize: 12, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.name}
                  </p>
                  <p style={{ color: m.color, fontSize: 10, margin: '2px 0 0', fontWeight: 600 }}>
                    {m.icon} {m.label}
                  </p>
                  {/* Hazard details from notes/hazard field */}
                  {h.hazard && h.hazard !== 'None' && (
                    <p style={{ color: '#6b7280', fontSize: 10, margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {h.hazard}
                    </p>
                  )}
                </div>
                <span style={{ flexShrink: 0, fontSize: 10, color: '#4b5563', marginTop: 2 }}>
                  {h.id}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Footer tip */}
      <div style={{ padding: '7px 14px', background: 'rgba(31,41,55,0.5)', color: '#4b5563', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
        🚒 Tap a hydrant to view details and find an alternative
      </div>
    </div>
  );
}
