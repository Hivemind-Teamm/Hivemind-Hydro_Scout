'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FiCheck, FiX } from 'react-icons/fi';
import { useStationNotifications, type JoinRequest, type StationNotification } from '@/lib/use-station-notifications';
import { responseDuration, stationNotificationCardKey } from '@/lib/station-notification-feed';
import { getUserProfile } from '@/lib/user-profile';
import UserProfileModal, { type ViewingUser } from './UserProfileModal';
import PillBadge from './PillBadge';
import { notificationStyle } from '@/lib/notification-style';
import NotificationCountBadge from './NotificationCountBadge';
import { accountLoginStatus } from '@/lib/account-login-status';

function time(value?: { toDate?: () => Date } | null) {
  const date = value?.toDate?.();
  return date ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Manila' }).format(date) : 'Not recorded';
}
function UnreadDot({ label }: { label: string }) {
  return <span role="img" aria-label={label} className="h-2 w-2 shrink-0 rounded-full bg-[#e0353b]" />;
}

function NotificationDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-labelledby="notification-detail-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl bg-white p-5 font-sans text-neutral-800 shadow-2xl backdrop:bg-black/50 dark:bg-neutral-900 dark:text-neutral-100">
    <header className="mb-4 flex items-start justify-between gap-4">
      <h2 id="notification-detail-title" className="text-sm font-bold leading-relaxed">{title}</h2>
      <button type="button" onClick={onClose} aria-label="Close notification details" className="rounded-lg p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"><FiX /></button>
    </header>
    {children}
  </dialog>;
}

export default function StationNotificationPanels({ stationName, activityOpen, membersOpen, closeActivity, closeMembers, reviewRequest, onViewFireLocation }: {
  stationName: string; activityOpen: boolean; membersOpen: boolean;
  closeActivity: () => void; closeMembers: () => void;
  reviewRequest: (request: JoinRequest, approved: boolean) => Promise<void>;
  onViewFireLocation: (lat: number, lng: number) => void;
}) {
  const { notifications, requests, error: notificationError, activityUnreadCount, isMemberUnread, readActivity, readMember, fullDetails } = useStationNotifications();
  const [profile, setProfile] = useState<ViewingUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const selected = notifications.find(item => stationNotificationCardKey(item) === selectedKey);
  const hasActiveResponse = notifications.some(item => item.response?.status === 'active' || (item.responseGroup?.activeCount ?? 0) > 0);
  const opening = useRef(false);

  useEffect(() => {
    if (!hasActiveResponse || (!activityOpen && !selectedKey)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasActiveResponse, activityOpen, selectedKey]);

  function openNotification(item: StationNotification) {
    if (item.type === 'fire-pinned' && typeof item.lat === 'number' && typeof item.lng === 'number'
      && Number.isFinite(item.lat) && Number.isFinite(item.lng) && Math.abs(item.lat) <= 90 && Math.abs(item.lng) <= 180) {
      readActivity(item);
      setSelectedKey(null);
      closeActivity();
      onViewFireLocation(item.lat, item.lng);
      return;
    }
    setNow(Date.now());
    setSelectedKey(stationNotificationCardKey(item));
    if (!item.responseGroup) readActivity(item);
  }

  async function openProfile(uid: string, fallback: ViewingUser, markRead: () => void) {
    if (opening.current) return;
    opening.current = true;
    setSelectedKey(null);
    setLoading(true);
    setError(null);
    try {
      const result = await getUserProfile(uid);
      if (!result.data) { setError('This account no longer exists.'); return; }
      const data = result.data;
      const roles: Record<string, string> = { admin: 'Admin', head: 'Head', authorized: 'Authorized User', general: 'General User' };
      setProfile({ uid, name: data.displayName || fallback.name, role: roles[data.role] ?? fallback.role,
        accountType: data.accountType, station: data.station, status: data.stationMembershipStatus,
        lastLoginAt: accountLoginStatus(data.lastLoginAt).lastLoginAt });
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
      className="pointer-events-auto relative font-semibold text-[#e0353b] hover:underline focus-visible:outline-2 focus-visible:outline-red-500 disabled:opacity-50">{name}</button>
  );
  const panel = 'pointer-events-auto absolute right-4 top-[calc(4.25rem+env(safe-area-inset-top,0px))] z-[4001] flex max-h-[70dvh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-white font-sans shadow-2xl dark:bg-neutral-900';
  const header = (title: string, subtitle: string, close: () => void) => (
    <header className="flex items-center justify-between gap-3 bg-[#e0353b] px-4 py-3 text-white">
      <div>
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <p className="text-[10px] text-white/75">{stationName} · {subtitle}</p>
      </div>
      <button onClick={close} aria-label={`Close ${title.toLowerCase()}`} className="rounded p-2 text-white/80 hover:bg-white/15 hover:text-white"><FiX /></button>
    </header>
  );
  return <>
    {(activityOpen || membersOpen) && <button type="button" aria-label="Close notifications"
      onClick={activityOpen ? closeActivity : closeMembers}
      className="pointer-events-auto absolute inset-0 z-[4000] bg-black/25" />}
    {(activityOpen || membersOpen) && <section aria-label={activityOpen ? 'Station activity' : 'Member approvals'} className={panel}>
      {activityOpen ? header(fullDetails ? 'Station activity' : 'Notifications', fullDetails ? 'Map, account and response updates' : 'Station operations and your updates', closeActivity) : header('Member approvals', 'Pending membership requests', closeMembers)}
      <p className="border-b border-neutral-100 px-4 py-2 text-[10px] text-neutral-400 dark:border-neutral-800">Open a notification to read it. In daily response groups, expand each entry to mark it read. Times are shown in PHT.</p>
      {(error || notificationError) && <p role="alert" className="px-4 py-2 text-xs text-red-600">{error || notificationError}</p>}
      {loading && <p role="status" className="px-4 py-2 text-xs text-neutral-500">Opening account…</p>}
      <div className="scroll-fade min-h-0 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
        {activityOpen ? notifications.map(item => {
          const assignment = item.type === 'personal-station-assigned';
          const response = item.response;
          const group = item.responseGroup;
          const active = response?.status === 'active' || (group?.activeCount ?? 0) > 0;
          const { color, label } = notificationStyle(response || group ? active ? 'response-started' : 'response-ended' : item.type);
          const read = () => readActivity(item);
          return <article key={stationNotificationCardKey(item)} style={{ borderLeftColor: color }} className={`relative border-l-[3px] px-4 py-3 transition-colors hover:bg-neutral-50 focus-within:bg-neutral-50 dark:hover:bg-neutral-800/50 dark:focus-within:bg-neutral-800/50 ${active ? 'response-notification-active' : ''}`}>
            <button type="button" onClick={() => openNotification(item)} aria-label={`${item.type === 'fire-pinned' ? 'View fire incident on map' : 'Open notification'}: ${item.message}`} aria-haspopup={item.type === 'fire-pinned' ? undefined : 'dialog'}
              className="absolute inset-0 h-full w-full cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-500" />
            <div className="pointer-events-none relative">
            <div className="mb-1 flex items-center justify-between gap-3">
              <PillBadge dot={color} color={color} label={group ? 'Response activity' : label} />
              <NotificationCountBadge count={activityUnreadCount(item)} label="unread activity updates" />
            </div>
            {group && <div className="mt-2 space-y-1 text-[10px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              <p>{group.day} · {group.entries.length} {group.entries.length === 1 ? 'response' : 'responses'} · {group.activeCount} active · {group.entries.length - group.activeCount} ended</p>
              <p className="font-semibold">Open to view {item.limited ? 'response summaries' : 'personnel details'}</p>
            </div>}
            <div className="text-xs font-semibold leading-relaxed text-neutral-800 dark:text-neutral-100">
              {assignment && item.uid && item.targetUid ? <>
                {accountLink(item.uid, item.displayName || item.adminEmail || 'Admin', 'Admin', read)}
                {' assigned '}
                {accountLink(item.targetUid, item.targetName || 'Member', 'Member', read)}
                {' to '}{stationName}.
              </> : item.message}
            </div>
            {response && <dl className="mt-2 space-y-1 text-[10px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              <div><dt className="inline font-semibold">Station: </dt><dd className="inline">{response.stationName || stationName}</dd></div>
              <div><dt className="inline font-semibold">Started: </dt><dd className="inline">{time(response.startedAt)}</dd></div>
              <div><dt className="inline font-semibold">Ended: </dt><dd className="inline">{active ? 'Response ongoing' : time(response.endedAt)}</dd></div>
              <div><dt className="inline font-semibold">Duration: </dt><dd className="inline">{responseDuration(response, now)}</dd></div>
              {response.endReason === 'station-head' && <div className="font-semibold text-amber-700 dark:text-amber-400">Closed by station management</div>}
            </dl>}
            <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">
              {!assignment && item.uid && <>{accountLink(item.uid, item.displayName || 'View account', 'Member', read)}{' · '}</>}
              {time(item.createdAt)}
            </p>
            </div>
          </article>;
        }) : requests.map(request => <article key={request.id} style={{ borderLeftColor: notificationStyle('membership-pending').color }} className="relative border-l-[3px] px-4 py-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
          <button type="button" disabled={loading}
            onClick={() => void openProfile(request.uid, { name: request.displayName, role: 'General User' }, () => readMember(request))}
            aria-label={`Open membership request from ${request.displayName}`} aria-haspopup="dialog"
            className="absolute inset-0 h-full w-full cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-500" />
          <div className="pointer-events-none relative">
          <div className="mb-1 flex items-center justify-between gap-3">
            <PillBadge dot={notificationStyle('membership-pending').color} color={notificationStyle('membership-pending').color} label="Membership request" />
            {isMemberUnread(request) && <UnreadDot label="Unread member request" />}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs">
              {accountLink(request.uid, request.displayName, 'General User', () => readMember(request))}
              <p className="mt-0.5 truncate text-[11px] text-neutral-500">{request.email}</p>
              <p className="mt-1 text-[10px] text-neutral-400">{time(request.createdAt)}</p>
            </div>
            <div className="pointer-events-auto relative flex shrink-0 gap-1">
              <button onClick={() => void reviewRequest(request, true)} aria-label={`Approve ${request.displayName} and assign station`} title="Approve and assign station" className="rounded bg-green-600 p-2 text-white"><FiCheck /></button>
              <button onClick={() => void reviewRequest(request, false)} aria-label={`Reject ${request.displayName}`} title="Reject" className="rounded bg-red-600 p-2 text-white"><FiX /></button>
            </div>
          </div>
          </div>
        </article>)}
        {(activityOpen ? !notifications.length : !requests.length) && <p className="px-4 py-8 text-center text-xs text-neutral-400">{activityOpen ? 'No station activity yet.' : 'No pending member requests.'}</p>}
      </div>
    </section>}
    {selected && <NotificationDialog title={selected.type === 'personal-station-assigned' && selected.uid && selected.targetUid
      ? `${selected.displayName || selected.adminEmail || 'Admin'} assigned ${selected.targetName || 'Member'} to ${stationName}.`
      : selected.message} onClose={() => setSelectedKey(null)}>
      {selected.responseGroup && <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <p className="font-semibold">{stationName} · {selected.responseGroup.day} (PHT)</p>
          <NotificationCountBadge count={activityUnreadCount(selected)} label="unread response updates" />
        </div>
        <p className="text-[11px] text-neutral-500">Expand an entry to view its details and mark that update as read.</p>
        {selected.responseGroup.entries.map((entry, index) => {
          const response = entry.response!;
          const active = response.status === 'active';
          return <details key={stationNotificationCardKey(entry)}
            onToggle={event => { if (event.currentTarget.open) readActivity(entry); }}
            className={`rounded-xl border border-neutral-200 p-3 dark:border-neutral-700 ${active ? 'response-notification-active' : ''}`}>
            <summary className="cursor-pointer text-xs font-semibold">
              <span className="inline-flex w-[calc(100%-1rem)] items-center justify-between gap-2 align-middle">
                <span>{entry.limited ? `Station response ${index + 1}` : entry.displayName || response.displayName || 'Responder'}
                  <span className="mt-0.5 block text-[10px] font-normal text-neutral-500">{active ? 'Responding' : 'Response ended'} · {time(response.startedAt)}</span>
                </span>
                <NotificationCountBadge count={activityUnreadCount(entry)} label="unread response updates" />
              </span>
            </summary>
            <dl className="mt-3 space-y-2 border-t border-neutral-100 pt-3 text-xs dark:border-neutral-800">
              {!entry.limited && entry.uid && <div><dt className="text-neutral-400">Personnel</dt><dd>{accountLink(entry.uid, entry.displayName || 'View account', 'Member', () => readActivity(entry))}</dd></div>}
              <div><dt className="text-neutral-400">Status</dt><dd>{active ? 'Responding' : 'Ended'}</dd></div>
              <div><dt className="text-neutral-400">Started</dt><dd>{time(response.startedAt)}</dd></div>
              <div><dt className="text-neutral-400">Ended</dt><dd>{active ? 'Response ongoing' : time(response.endedAt)}</dd></div>
              <div><dt className="text-neutral-400">Duration</dt><dd>{responseDuration(response, now)}</dd></div>
              {typeof response.incidentLat === 'number' && typeof response.incidentLng === 'number' && <>
                <div><dt className="text-neutral-400">Fire incident latitude</dt><dd>{response.incidentLat.toFixed(6)}</dd></div>
                <div><dt className="text-neutral-400">Fire incident longitude</dt><dd>{response.incidentLng.toFixed(6)}</dd></div>
                <div><button type="button" className="font-semibold text-[#e0353b] hover:underline" onClick={() => {
                  readActivity(entry); setSelectedKey(null); closeActivity(); onViewFireLocation(response.incidentLat!, response.incidentLng!);
                }}>View in map</button></div>
              </>}
              {response.endReason === 'incident-cleared' && <div>Ended automatically when the fire incident was cleared.</div>}
              {!entry.limited && <>
                <div><dt className="text-neutral-400">Last location report</dt><dd>{time(response.lastLocationAt)}</dd></div>
                {response.endedByName && <div><dt className="text-neutral-400">Ended by</dt><dd>{response.endedByUid ? accountLink(response.endedByUid, response.endedByName, 'Member', () => readActivity(entry)) : response.endedByName}</dd></div>}
                {response.endReason === 'station-head' && <div className="text-amber-600">Closed by station management</div>}
              </>}
              <div><dt className="text-neutral-400">Latest update</dt><dd>{time(entry.createdAt)}</dd></div>
            </dl>
          </details>;
        })}
      </div>}
      {selected.hydrantId && <p className="mb-2 text-xs font-semibold">Hydrant: {selected.hydrantId}</p>}
      {typeof selected.lat === 'number' && typeof selected.lng === 'number' && <p className="mb-2 text-xs">Location: {selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}</p>}
      <p className="mb-3 text-[10px] uppercase tracking-wide text-neutral-400">Notification details · Philippine time (PHT)</p>
      {!selected.responseGroup && <dl className="space-y-3 text-xs">
        <div><dt className="text-neutral-400">Station</dt><dd className="mt-1 font-semibold">{selected.response?.stationName || stationName}</dd></div>
        {selected.response ? <>
          {!selected.limited && <div><dt className="text-neutral-400">Responder</dt><dd className="mt-1">{selected.uid ? accountLink(selected.uid, selected.displayName || 'Responder', 'Member', () => readActivity(selected)) : selected.displayName}</dd></div>}
          <div><dt className="text-neutral-400">Status</dt><dd className="mt-1 font-semibold">{selected.response.status === 'active' ? 'Responding' : 'Ended'}</dd></div>
          <div><dt className="text-neutral-400">Started</dt><dd className="mt-1">{time(selected.response.startedAt)}</dd></div>
          <div><dt className="text-neutral-400">Ended</dt><dd className="mt-1">{selected.response.status === 'active' ? 'Response ongoing' : time(selected.response.endedAt)}</dd></div>
          <div><dt className="text-neutral-400">Duration</dt><dd className="mt-1">{responseDuration(selected.response, now)}</dd></div>
          {!selected.limited && <div><dt className="text-neutral-400">Last location report</dt><dd className="mt-1">{time(selected.response.lastLocationAt)}</dd></div>}
          {selected.response.endedByName && <div><dt className="text-neutral-400">Ended by</dt><dd className="mt-1">{selected.response.endedByUid ? accountLink(selected.response.endedByUid, selected.response.endedByName, 'Member', () => readActivity(selected)) : selected.response.endedByName}{selected.response.endReason === 'station-head' ? ' · Station management' : ''}</dd></div>}
          {!selected.limited && <div><dt className="text-neutral-400">Response ID</dt><dd className="mt-1 break-all font-mono text-[10px]">{selected.responseId}</dd></div>}
        </> : <>
          {selected.uid && <div><dt className="text-neutral-400">{selected.type === 'personal-station-assigned' ? 'Admin' : 'Account'}</dt><dd className="mt-1">{accountLink(selected.uid, selected.displayName || selected.adminEmail || 'View account', selected.type === 'personal-station-assigned' ? 'Admin' : 'Member', () => readActivity(selected))}</dd></div>}
          {selected.targetUid && <div><dt className="text-neutral-400">Edited account</dt><dd className="mt-1">{accountLink(selected.targetUid, selected.targetName || 'View account', 'Member', () => readActivity(selected))}</dd></div>}
        </>}
        <div><dt className="text-neutral-400">Notification date and time</dt><dd className="mt-1">{time(selected.createdAt)}</dd></div>
      </dl>}
    </NotificationDialog>}
    {fullDetails && profile && <UserProfileModal user={profile} onClose={() => setProfile(null)} />}
  </>;
}
