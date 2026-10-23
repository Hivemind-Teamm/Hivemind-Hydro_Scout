'use client';

import { useEffect, useRef } from 'react';

export default function LocationConsentNotice({ granted, storageError, onAllow, onDecline, onClose }: {
  granted: boolean; storageError: boolean; onAllow: () => void; onDecline: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const controller = process.env.NEXT_PUBLIC_LOCATION_PRIVACY_CONTROLLER?.trim();
  const contact = process.env.NEXT_PUBLIC_LOCATION_PRIVACY_CONTACT?.trim();
  return (
    <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (granted) onClose(); else onDecline(); }}
      aria-labelledby="location-consent-title"
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-6 text-neutral-800 shadow-2xl backdrop:bg-black/60 dark:bg-neutral-900 dark:text-neutral-100">
      <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Location privacy · RA 10173</p>
      <h2 id="location-consent-title" className="mt-2 text-xl font-bold">Share this device’s location during responses?</h2>
      <div className="mt-4 space-y-3 text-sm leading-relaxed">
        <p>Your choice is optional. Location is captured only after you sign in to an approved station-linked personal account and press <strong>Start responding</strong>. Declining does not prevent using the map.</p>
        <p><strong>Purpose and data.</strong> With your consent, Hydro-Scout collects this device’s latitude, longitude, GPS accuracy, report time, station ID and station name to coordinate responses, find suitable hydrants and show which stations have active responders. The map pin identifies the station, not your name. Your name and response start/end times are stored in the station’s private response history.</p>
        <p><strong>Updates.</strong> While your response is active and this app is open or resumed, location updates are attempted immediately and about every three minutes. Closing the app, device sleep, loss of connectivity or browser suspension can pause updates. Browser location permission is also required. This is not guaranteed background or 24/7 tracking.</p>
        <p><strong>Recipients and storage.</strong> Active station-labeled locations are visible to signed-in Hydro-Scout users for cross-station coordination; they are not shown to unauthenticated public visitors. Only the station’s head and authorized delegates can see responder names and station response history. Station heads receive in-app response notifications. Locations and response records are stored in Google Firebase/Cloud Firestore. Ending a response removes its live map location; the station history remains.</p>
        <p><strong>Your choice and rights.</strong> Use “Location privacy” to withdraw consent. Withdrawal stops location updates and removes the current public map location; end your response separately to update its status. Contact the controller to request access, correction or deletion, object to processing, or exercise other rights under RA 10173. You may also raise a complaint with the National Privacy Commission.</p>
        <p><strong>Map services.</strong> If you use routing or nearby-hydrant searches, your coordinates may also be sent to Mapbox or the routing provider configured by the app. Browser location estimates can be inaccurate.</p>
        <p><strong>Consent record.</strong> Your account, station, decision, notice version and decision time are stored on this browser until you clear site data or a new notice requires another choice. Each device must make its own choice. Being linked to a station does not share your location; you must start a response.</p>
        <p><strong>Controller:</strong> {controller || 'Not yet configured by the project administrator.'}<br /><strong>Privacy contact:</strong> {contact || 'Not yet configured by the project administrator.'}</p>
        {(!controller || !contact) && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Controller and privacy contact details are pending configuration.</p>}
        <a href="https://privacy.gov.ph/data-privacy-act-/" target="_blank" rel="noreferrer" className="text-red-600 underline">Read the Data Privacy Act of 2012</a>
      </div>
      {storageError && <p role="alert" className="mt-3 text-sm text-red-600">Your choice could not be saved. Enable browser storage and try again. Sharing remains disabled unless consent was already saved.</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={onDecline} className="flex-1 rounded-lg border border-neutral-300 px-4 py-3 text-sm font-semibold">{granted ? 'Withdraw consent' : 'Continue without sharing'}</button>
        <button type="button" onClick={onAllow} className="flex-1 rounded-lg bg-red-600 px-4 py-3 text-sm font-semibold text-white">I consent to location sharing</button>
        {granted && <button type="button" onClick={onClose} className="w-full text-sm underline">Close notice</button>}
      </div>
    </dialog>
  );
}
