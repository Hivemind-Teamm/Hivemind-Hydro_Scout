import type { DocumentData } from 'firebase/firestore';
import { accountLoginStatus } from './account-login-status';

export const MEMBER_ROLE_LABELS: Record<string, string> = { admin: 'Admin', head: 'Head', authorized: 'Authorized User', general: 'General User' };
export type StationMember = { uid: string; name: string; role: string; stationId: string; membership?: string; lastLoginAt: Date | null };

export function stationMemberFromProfile(uid: string, data: DocumentData, stationId: string): StationMember | null {
  if (data.stationId !== stationId || data.accountType !== 'person'
    || ![undefined, null, 'none', 'approved'].includes(data.stationMembershipStatus)) return null;
  return { uid, name: typeof data.displayName === 'string' && data.displayName.trim() ? data.displayName.trim() : 'Member',
    role: typeof data.role === 'string' && Object.hasOwn(MEMBER_ROLE_LABELS, data.role) ? MEMBER_ROLE_LABELS[data.role] : 'Member', stationId,
    membership: data.stationMembershipStatus, lastLoginAt: accountLoginStatus(data.lastLoginAt).lastLoginAt };
}

export function searchStationMembers(members: StationMember[], search: string) {
  const value = search.trim().toLocaleLowerCase();
  return members.filter(member => `${member.name} ${member.role}`.toLocaleLowerCase().includes(value))
    .sort((a, b) => a.name.localeCompare(b.name) || a.uid.localeCompare(b.uid));
}
