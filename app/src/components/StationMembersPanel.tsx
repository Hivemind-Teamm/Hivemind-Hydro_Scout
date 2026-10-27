'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { FiX } from 'react-icons/fi';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { stationMemberFromProfile, searchStationMembers, type StationMember } from '@/lib/station-members';
import { accountIsPresent, type PresenceRecord } from '@/lib/account-presence-state';
import { lastLoggedInLabel } from '@/lib/account-login-status';
import { useLoginClock } from '@/lib/use-login-clock';
import UserProfileModal, { type ViewingUser } from './UserProfileModal';

export default function StationMembersPanel({ stationId, stationName, respondingUids, responsesReady, onClose }: {
  stationId: string; stationName: string; respondingUids: Set<string>; responsesReady: boolean; onClose: () => void;
}) {
  const { user, role } = useAuth();
  const allowed = !!user && (role === 'head' || role === 'admin');
  const scope = allowed ? `${user.uid}:${stationId}` : null;
  const now = useLoginClock();
  const [state, setState] = useState<{ scope: string | null; members: StationMember[]; loading: boolean; error: string | null }>({ scope: null, members: [], loading: true, error: null });
  const [presence, setPresence] = useState<{ scope: string | null; records: PresenceRecord[]; receivedAt: number }>({ scope: null, records: [], receivedAt: 0 });
  const [search, setSearch] = useState('');
  const [profile, setProfile] = useState<ViewingUser | null>(null);
  useEffect(() => {
    if (!scope) return;
    const stopMembers = onSnapshot(query(collection(db, 'users'), where('stationId', '==', stationId), where('accountType', '==', 'person')), snapshot => {
      const members = snapshot.docs.flatMap(record => {
        const member = stationMemberFromProfile(record.id, record.data(), stationId);
        return member ? [member] : [];
      });
      setState({ scope, members, loading: false, error: null });
    }, () => setState({ scope, members: [], loading: false, error: 'Station members could not load. Check your connection and station access.' }));
    const stopPresence = onSnapshot(query(collection(db, 'accountPresenceSessions'), where('stationId', '==', stationId)), snapshot => {
      setPresence({ scope, records: snapshot.docs.map(record => record.data() as PresenceRecord), receivedAt: Date.now() });
    }, () => setPresence({ scope, records: [], receivedAt: 0 }));
    return () => { stopMembers(); stopPresence(); };
  }, [scope, stationId]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [onClose]);
  if (!scope) return null;
  const members = state.scope === scope ? state.members : [];
  const visible = searchStationMembers(members, search);
  const online = (uid: string) => user?.uid === uid || (presence.scope === scope && accountIsPresent(presence.records, uid, Math.max(now, presence.receivedAt)));
  const liveProfile = profile && members.find(member => member.uid === profile.uid);
  return <>
    <button type="button" aria-label="Close station members" onClick={onClose} className="pointer-events-auto absolute inset-0 z-[4000] bg-black/25" />
    <section aria-label="Station members" className="pointer-events-auto absolute right-4 top-[calc(4.25rem+env(safe-area-inset-top,0px))] z-[4001] flex max-h-[75dvh] w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-900">
      <header className="flex items-start justify-between gap-3 bg-[#e0353b] px-4 py-3 text-white">
        <div><h2 className="text-sm font-extrabold uppercase tracking-wide">Station Members</h2>
          <p className="mt-0.5 text-[11px] text-white/75">{stationName} · {stationId}</p></div>
        <button type="button" onClick={onClose} aria-label="Close station members" className="rounded-lg p-2 text-white/80 hover:bg-white/15 hover:text-white"><FiX /></button>
      </header>
      <div className="space-y-2 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <p className="text-[11px] text-neutral-500">{members.length} members · {members.filter(member => online(member.uid)).length} active now · {responsesReady ? `${members.filter(member => respondingUids.has(member.uid)).length} responding` : 'Response status unavailable'}</p>
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search station members" placeholder="Search name or role" className="w-full rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-xs text-neutral-800 outline-none focus:border-[#e0353b] dark:border-neutral-700 dark:text-neutral-100" />
      </div>
      <div className="min-h-0 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
        {(state.scope !== scope || state.loading) && <p role="status" className="px-4 py-6 text-center text-xs text-neutral-400">Loading station members…</p>}
        {state.scope === scope && state.error && <p role="alert" className="px-4 py-4 text-xs text-red-600">{state.error}</p>}
        {visible.map(member => <button key={member.uid} type="button"
          onClick={() => setProfile({ uid: member.uid, name: member.name, role: member.role, station: stationName, accountType: 'person', status: member.membership, lastLoginAt: member.lastLoginAt })}
          className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e0353b] dark:hover:bg-neutral-800/50">
          <span className="min-w-0"><span className="block break-words text-xs font-bold text-neutral-800 dark:text-neutral-100">{member.name}</span>
            <span className="mt-0.5 block text-[10px] text-neutral-500">{member.role}</span>
            <span className={`mt-1 flex items-start gap-1.5 text-[10px] ${online(member.uid) ? 'text-green-600 dark:text-green-400' : 'text-neutral-400'}`}>
              <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${online(member.uid) ? 'bg-green-500' : 'bg-neutral-400'}`} />
              {online(member.uid) ? 'Active now' : lastLoggedInLabel(member.lastLoginAt)}
            </span></span>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${respondingUids.has(member.uid) ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800'}`}>
            {!responsesReady ? 'Status unavailable' : respondingUids.has(member.uid) ? 'Responding' : 'Not responding'}
          </span>
        </button>)}
        {state.scope === scope && !state.loading && !state.error && !visible.length && <p className="px-4 py-6 text-center text-xs text-neutral-400">{members.length ? 'No matching members.' : 'No assigned members yet.'}</p>}
      </div>
      <p className="border-t border-neutral-100 px-4 py-2 text-[10px] text-neutral-400 dark:border-neutral-800">Pending requests stay in Member Approvals. Select a member to view their profile.</p>
    </section>
    {liveProfile && <UserProfileModal user={{ ...profile!, name: liveProfile.name, role: liveProfile.role, status: liveProfile.membership, lastLoginAt: liveProfile.lastLoginAt }} onClose={() => setProfile(null)} />}
  </>;
}
