'use client';

import { useState, useCallback } from 'react';
import { findNearestHydrants, type RankedHydrant, type NearestHydrantResult } from '../../../lib/nearest-hydrant';

const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconClose = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconLocation = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);

interface NearestHydrantPanelProps {
  userPosition: { lat: number; lng: number } | null;
  onHydrantSelect: (hydrant: RankedHydrant | null) => void;
  selectedHydrantId?: string | null;
}

function formatDistance(metres: number): string {
  if (metres < 1000) return `${metres} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export default function NearestHydrantPanel({
  userPosition,
  onHydrantSelect,
  selectedHydrantId,
}: NearestHydrantPanelProps) {
  const [result, setResult] = useState<NearestHydrantResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!userPosition) {
      setError('Enable GPS location first — click the locate button on the map.');
      setIsOpen(true);
      return;
    }
    setLoading(true);
    setError(null);
    setIsOpen(true);
    onHydrantSelect(null);
    try {
      const data = await findNearestHydrants(userPosition.lat, userPosition.lng);
      setResult(data);
      if (data.withinRadius.length > 0) {
        onHydrantSelect(data.withinRadius[0]);
      }
    } catch (err) {
      setError('Search failed. Please try again.');
      console.error('[NearestHydrantPanel]', err);
    } finally {
      setLoading(false);
    }
  }, [userPosition, onHydrantSelect]);

  const handleClose = () => {
    setIsOpen(false);
    setResult(null);
    setError(null);
    onHydrantSelect(null);
  };

  return (
    // Outer wrapper — pointer-events-none so it doesn't block map clicks
    // The button and panel inside opt back in with pointer-events-auto
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, width: 280 }}>

      {/* ── Button ── */}
      <button
        onClick={handleSearch}
        disabled={loading}
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 18px',
          borderRadius: 14,
          border: 'none',
          cursor: loading ? 'wait' : 'pointer',
          fontWeight: 700,
          fontSize: 14,
          color: '#fff',
          background: loading ? '#1d4ed8' : '#2563eb',
          boxShadow: '0 4px 16px rgba(37,99,235,0.5), 0 2px 6px rgba(0,0,0,0.4)',
          transition: 'background 0.15s, transform 0.1s',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8'; }}
        onMouseLeave={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = '#2563eb'; }}
      >
        {loading ? (
          <>
            <span style={{
              display: 'inline-block', width: 16, height: 16,
              border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
              borderRadius: '50%', animation: 'spin 0.7s linear infinite',
            }} />
            Searching…
          </>
        ) : (
          <>
            <IconSearch />
            Find Nearest Hydrant
          </>
        )}
      </button>

      {/* ── Result / Error panel ── */}
      {isOpen && (
        <div style={{
          pointerEvents: 'auto',
          background: 'rgba(17,24,39,0.97)',
          border: '1px solid rgba(75,85,99,0.8)',
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          overflow: 'hidden',
          width: 280,
          backdropFilter: 'blur(12px)',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(75,85,99,0.5)' }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              🔍 Nearest Hydrants
              {result && <span style={{ color: '#6b7280', fontWeight: 400 }}>within 2 km</span>}
            </span>
            <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4, borderRadius: 6, display: 'flex' }}>
              <IconClose />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div style={{ padding: '12px 16px', color: '#fbbf24', fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span>⚠️</span><span>{error}</span>
            </div>
          )}

          {/* No hydrants */}
          {result?.noHydrantsFound && !error && (
            <div style={{ padding: '20px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🚫</div>
              <p style={{ color: '#fff', fontWeight: 600, fontSize: 13, margin: 0 }}>No operational hydrants nearby</p>
              <p style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>Nothing within 2 km of your location.</p>
              {result.ranked.length > 0 && (
                <p style={{ color: '#4b5563', fontSize: 11, marginTop: 4 }}>
                  Nearest is {formatDistance(result.ranked[0].sortDistance)} away.
                </p>
              )}
            </div>
          )}

          {/* Hydrant list */}
          {result && result.withinRadius.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 280, overflowY: 'auto' }}>
              {result.withinRadius.map((hydrant, index) => {
                const isSelected = selectedHydrantId === hydrant.id;
                return (
                  <li key={hydrant.id} style={{ borderBottom: '1px solid rgba(55,65,81,0.5)' }}>
                    <button
                      onClick={() => onHydrantSelect(hydrant)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '12px 16px',
                        background: isSelected ? 'rgba(30,58,138,0.4)' : 'transparent',
                        border: 'none', borderLeft: isSelected ? '2px solid #60a5fa' : '2px solid transparent',
                        cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(55,65,81,0.5)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = isSelected ? 'rgba(30,58,138,0.4)' : 'transparent'; }}
                    >
                      {/* Rank */}
                      <div style={{
                        flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
                        background: index === 0 ? 'rgba(52,211,153,0.15)' : 'rgba(75,85,99,0.4)',
                        color: index === 0 ? '#34d399' : '#9ca3af',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 800,
                      }}>
                        {index + 1}
                      </div>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {hydrant.name}
                        </p>
                        {hydrant.area && <p style={{ color: '#6b7280', fontSize: 11, margin: '2px 0 0' }}>{hydrant.area}</p>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <span style={{ color: index === 0 ? '#34d399' : '#60a5fa', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <IconLocation />{formatDistance(hydrant.sortDistance)}
                          </span>
                          {hydrant.travelMetres !== null && (
                            <span style={{ color: '#4b5563', fontSize: 11 }}>walking est.</span>
                          )}
                        </div>
                      </div>
                      {/* Nearest badge */}
                      {index === 0 && (
                        <span style={{ flexShrink: 0, fontSize: 10, background: 'rgba(52,211,153,0.15)', color: '#34d399', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>
                          Nearest
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Footer */}
          {result && !result.noHydrantsFound && (
            <div style={{ padding: '8px 16px', background: 'rgba(31,41,55,0.5)', color: '#4b5563', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
              🗺 Distances via Mapbox walking isochrone
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
