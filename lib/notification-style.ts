/** Notification colors describe the event, never the hydrant pressure. */
export function notificationStyle(type: string) {
  switch (type) {
    case 'hydrant-pinned': return { color: '#854d0e', label: 'Hydrant pinned' };
    case 'hydrant-updated': return { color: '#2563eb', label: 'Hydrant update' };
    case 'fire-pinned': return { color: '#ea580c', label: 'Fire incident' };
    case 'response-started': return { color: '#0891b2', label: 'Responding' };
    case 'response-ended':
    case 'station-response-closed': return { color: '#64748b', label: 'Response ended' };
    case 'personal-station-assigned': return { color: '#9333ea', label: 'Account assignment' };
    case 'membership-approved': return { color: '#db2777', label: 'Membership approved' };
    case 'membership-rejected': return { color: '#db2777', label: 'Membership denied' };
    case 'membership-pending': return { color: '#db2777', label: 'Membership request' };
    case 'report-resolved': return { color: '#16a34a', label: 'Resolved' };
    case 'report-pending': return { color: '#d97706', label: 'Pending' };
    case 'report-denied': return { color: '#dc2626', label: 'Denied' };
    default: return { color: '#64748b', label: 'Station activity' };
  }
}
