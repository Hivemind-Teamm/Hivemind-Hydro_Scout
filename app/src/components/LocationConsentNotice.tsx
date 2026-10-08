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
      <h2 id="location-consent-title" className="mt-2 text-xl font-bold">Share this device’s station location?</h2>
      <div className="mt-4 space-y-3 text-sm leading-relaxed">
        <p>Your choice is optional. Declining lets you continue using the map without automatic device location or station reporting.</p>
        <p><strong>Purpose and data.</strong> With your consent, Hydro-Scout collects this device’s latitude, longitude, GPS accuracy, report time, station ID and publishing account ID to show the latest station location for operational coordination. This is your device’s position, not the station building’s address.</p>
        <p><strong>Updates.</strong> Reports are attempted every three minutes while signed in and online, including background tabs where the browser permits it. Reloading or resuming requests a fresh report. Closing the app or device sleep may stop updates. Browser permission is also required.</p>
        <p><strong>Recipients and storage.</strong> Reports are stored in Google Firebase/Cloud Firestore. App administrators can view all station reports; accounts assigned to your station can view its report. Locations are not shown on the public map. Each new report replaces the previous one. The latest record stays stored until replaced or deleted by an administrator; hiding a stale pin after the configured timeout does not delete it.</p>
        <p><strong>Your choice and rights.</strong> Use “Location privacy” to withdraw consent at any time. Withdrawal stops further collection and publishing on this browser; it does not delete an existing report. Contact the controller to request access, correction or deletion, object to processing, or exercise other rights under RA 10173. You may also raise a complaint with the National Privacy Commission.</p>
        <p><strong>Map services.</strong> If you use routing or nearby-hydrant searches, your coordinates may also be sent to Mapbox or the routing provider configured by the app. Browser location estimates can be inaccurate.</p>
        <p><strong>Consent record.</strong> Your account, station, decision, notice version and decision time are stored on this browser until you clear site data or a new notice requires another choice. Other devices must make their own choice. Shared station accounts do not give permission to track every person using them.</p>
        <p><strong>Controller:</strong> {controller || 'Not yet configured by the project administrator.'}<br /><strong>Privacy contact:</strong> {contact || 'Not yet configured by the project administrator.'}</p>
        {(!controller || !contact) && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Location sharing is unavailable until the administrator supplies the controller and privacy contact details.</p>}
        <a href="https://privacy.gov.ph/data-privacy-act-/" target="_blank" rel="noreferrer" className="text-red-600 underline">Read the Data Privacy Act of 2012</a>
      </div>
      {storageError && <p role="alert" className="mt-3 text-sm text-red-600">Your choice could not be saved. Enable browser storage and try again. Sharing remains disabled unless consent was already saved.</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={onDecline} className="flex-1 rounded-lg border border-neutral-300 px-4 py-3 text-sm font-semibold">{granted ? 'Withdraw consent' : 'Continue without sharing'}</button>
        <button type="button" onClick={onAllow} disabled={!controller || !contact} className="flex-1 rounded-lg bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">I consent to location sharing</button>
        {granted && <button type="button" onClick={onClose} className="w-full text-sm underline">Close notice</button>}
      </div>
    </dialog>
  );
}
