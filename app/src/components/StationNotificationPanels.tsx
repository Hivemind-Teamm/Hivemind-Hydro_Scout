'use client';

import { useRef, useState } from 'react';
import { FiCheck, FiX } from 'react-icons/fi';
import { useStationNotifications, type JoinRequest } from '@/lib/use-station-notifications';
import { getUserProfile } from '@/lib/user-profile';
import UserProfileModal, { type ViewingUser } from './UserProfileModal';
import PillBadge from './PillBadge';

function time(value?: { toDate?: () => Date } | null) {
  return value?.toDate?.().toLocaleString() ?? 'Just now';
}
function UnreadDot({ label }: { label: string }) {
  return <span role="img" aria-label={label} className="h-2 w-2 shrink-0 rounded-full bg-[#e0353b]" />;
}

export default function StationNotificationPanels({ stationName, activityOpen, membersOpen, closeActivity, closeMembers, reviewRequest }: {
  stationName: string; activityOpen: boolean; membersOpen: boolean;
  closeActivity: () => void; closeMembers: () => void;
  reviewRequest: (request: JoinRequest, approved: boolean) => Promise<void>;
}) {
  const { notifications, requests, error: notificationError, isActivityUnread, isMemberUnread, readActivity, readMember } = useStationNotifications();
  const [profile, setProfile] = useState<ViewingUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const opening = useRef(false);

  async function openProfile(uid: string, fallback: ViewingUser, markRead: () => void) {
    if (opening.current) return;
    opening.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await getUserProfile(uid);
      if (!result.data) { setError('This account no longer exists.'); return; }
      const data = result.data;
      const roles: Record<string, string> = { admin: 'Admin', head: 'Head', authorized: 'Authorized User', general: 'General User' };
      setProfile({ uid, name: data.displayName || fallback.name, role: roles[data.role] ?? fallback.role,
        accountType: data.accountType, station: data.station, status: data.stationMembershipStatus });
      markRead();
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'permission-denied') {
        // Use the identity already disclosed by the notification. Do not expose private admin fields.
        setProfile({ ...fallback, uid });
        markRead();
      } else { setError('Could not open the account. Please try again.'); }
    } finally { opening.current = false; setLoading(false); }
  }

  const accountLink = (uid: string, name: string, role: string, markRead: () => void) => (
    <button disabled={loading} onClick={() => void openProfile(uid, { name, role }, markRead)}
      className="font-semibold text-[#e0353b] hover:underline focus-visible:outline-2 focus-visible:outline-red-500 disabled:opacity-50">{name}</button>
  );
  const panel = 'pointer-events-auto absolute right-4 top-[calc(4.25rem+env(safe-area-inset-top,0px))] z-[2501] flex max-h-[70dvh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-white font-sans shadow-2xl dark:bg-neutral-900';
  const header = (title: string, subtitle: string, close: () => void) => (
    <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
      <div>
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-neutral-800 dark:text-neutral-100">{title}</h2>
        <p className="text-[10px] text-neutral-400 dark:text-neutral-500">{stationName} · {subtitle}</p>
      </div>
      <button onClick={close} aria-label={`Close ${title.toLowerCase()}`} className="rounded p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"><FiX /></button>
    </header>
  );
  return <>
    {(activityOpen || membersOpen) && <section aria-label={activityOpen ? 'Station activity' : 'Member approvals'} className={panel}>
      {activityOpen ? header('Station activity', 'Account and response updates', closeActivity) : header('Member approvals', 'Pending membership requests', closeMembers)}
      <p className="border-b border-neutral-100 px-4 py-2 text-[10px] text-neutral-400 dark:border-neutral-800">Open a linked account to mark its notification as read.</p>
      {(error || notificationError) && <p role="alert" className="px-4 py-2 text-xs text-red-600">{error || notificationError}</p>}
      {loading && <p role="status" className="px-4 py-2 text-xs text-neutral-500">Opening account…</p>}
      <div className="scroll-fade min-h-0 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
        {activityOpen ? notifications.map(item => {
          const assignment = item.type === 'personal-station-assigned';
          const label = assignment ? 'Account assignment' : item.type.startsWith('membership-') ? 'Membership update' : 'Response activity';
          const read = () => readActivity(item);
          return <article key={item.id} className="border-l-[3px] border-[#e0353b] px-4 py-3">
            <div className="mb-1 flex items-center justify-between gap-3">
              <PillBadge dot="#737373" color="#737373" label={label} />
              {isActivityUnread(item) && <UnreadDot label="Unread activity" />}
            </div>
            <div className="text-xs font-semibold leading-relaxed text-neutral-800 dark:text-neutral-100">
              {assignment && item.uid && item.targetUid ? <>
                {accountLink(item.uid, item.displayName || item.adminEmail || 'Admin', 'Admin', read)}
                {' changed the station assignment for '}
                {accountLink(item.targetUid, item.targetName || 'Member', 'Member', read)}.
              </> : item.message}
            </div>
            <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">
              {!assignment && item.uid && <>{accountLink(item.uid, item.displayName || 'View account', 'Member', read)}{' · '}</>}
              {time(item.createdAt)}
            </p>
          </article>;
        }) : requests.map(request => <article key={request.id} className="border-l-[3px] border-[#d97706] px-4 py-3">
          <div className="mb-1 flex items-center justify-between gap-3">
            <PillBadge dot="#d97706" color="#d97706" label="Membership request" />
            {isMemberUnread(request) && <UnreadDot label="Unread member request" />}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs">
              {accountLink(request.uid, request.displayName, 'General User', () => readMember(request))}
              <p className="mt-0.5 truncate text-[11px] text-neutral-500">{request.email}</p>
              <p className="mt-1 text-[10px] text-neutral-400">{time(request.createdAt)}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button onClick={() => void reviewRequest(request, true)} aria-label={`Approve ${request.displayName} and assign station`} title="Approve and assign station" className="rounded bg-green-600 p-2 text-white"><FiCheck /></button>
              <button onClick={() => void reviewRequest(request, false)} aria-label={`Reject ${request.displayName}`} title="Reject" className="rounded bg-red-600 p-2 text-white"><FiX /></button>
            </div>
          </div>
        </article>)}
        {(activityOpen ? !notifications.length : !requests.length) && <p className="px-4 py-8 text-center text-xs text-neutral-400">{activityOpen ? 'No station activity yet.' : 'No pending member requests.'}</p>}
      </div>
    </section>}
    {profile && <UserProfileModal user={profile} onClose={() => setProfile(null)} />}
  </>;
}
