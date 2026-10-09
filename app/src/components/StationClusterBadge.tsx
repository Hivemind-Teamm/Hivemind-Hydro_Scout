import StationLogo from './StationLogo';

export default function StationClusterBadge({ stationIds }: { stationIds: string[] }) {
  if (!stationIds.length) return null;
  const label = `${stationIds.length} station${stationIds.length === 1 ? '' : 's'} in cluster: ${stationIds.join(', ')}`;
  return (
    <span role="img" aria-label={label} title={label}
      style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22,
        filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))' }}>
      <StationLogo size={22} />
    </span>
  );
}
