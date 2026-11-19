'use client';

import { useEffect, useRef } from 'react';
import { usePrivacyGovernance } from '@/lib/privacy-governance';
import { LOCATION_GOVERNANCE_REQUIRED } from '@/lib/use-location-consent';

export default function LocationConsentNotice({ granted, storageError, savingConsent, onAllow, onDecline, onClose }: {
  granted: boolean; storageError: boolean; savingConsent: boolean; onAllow: () => void; onDecline: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const {
    settings,
    loading: governanceLoading,
    error: governanceError,
    revision: governanceRevision,
  } = usePrivacyGovernance();

  const controller = settings.controller;
  const contact = settings.contact;
  return (
    <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (granted) onClose(); else onDecline(); }}
      aria-labelledby="location-consent-title"
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-6 text-neutral-800 shadow-2xl backdrop:bg-black/60 dark:bg-neutral-900 dark:text-neutral-100">
      <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Location privacy · RA 10173</p>
      <h2 id="location-consent-title" className="mt-2 text-xl font-bold">Share this device’s location during responses?</h2>
      <div className="mt-4 space-y-3 text-sm leading-relaxed">
        <p>Your choice is optional. Location is captured only after you sign in to an approved station-linked personal account and press <strong>Start responding</strong>. Declining does not prevent using the map.</p>
        <p><strong>Purpose and data.</strong> With your consent, Hydro-Scout collects this device’s latitude, longitude, GPS accuracy, report time, station ID and station name to coordinate responses, find suitable hydrants and show which stations have active responders. The map pin identifies the station, not your name. Your name and response start/end times are stored in the station’s private response history.</p>
        <p><strong>Updates.</strong> While your response is active and this app is open or resumed, this device checks its location, more often as you approach the incident. Your position is sent only while you are within 1 km of the fire: on arrival, when you move (at most once a minute) and about every three minutes. Outside 1 km only the time of your latest check is recorded, not your position. Closing the app, device sleep, loss of connectivity or browser suspension can pause updates. Browser location permission is also required. This is not guaranteed background or 24/7 tracking.</p>
        <p><strong>Recipients and storage.</strong> Your station-labeled location is visible to signed-in Hydro-Scout users for cross-station coordination only while you are within 1 km of the incident you are responding to; they are not shown to unauthenticated public visitors. Only the station’s head and authorized delegates can see responder names and station response history. Station heads receive in-app response notifications. Locations and response records are stored in Google Firebase/Cloud Firestore. Ending a response removes its live map location; the station history remains.</p>
        <p><strong>Your choice and rights.</strong> Use “Location privacy” to withdraw consent. Withdrawal immediately stops location sharing by this browser. Removal of an already-published live location requires server connectivity and may be delayed while offline; end your response separately to update its status. Contact the controller to request access, correction or deletion, object to processing, or exercise other rights under RA 10173. You may also raise a complaint with the National Privacy Commission.</p>
        <p><strong>Map services.</strong> If you use routing or nearby-hydrant searches, your coordinates may also be sent to Mapbox or the routing provider configured by the app. Browser location estimates can be inaccurate.</p>
        <p><strong>Consent record.</strong> Your account, station, decision, notice version and decision time are recorded in Cloud Firestore when successfully saved. This browser also remembers your choice. A new grant requires server verification before location sharing is enabled. Clearing browser data does not delete a server consent record. You must start a response separately before sharing location.</p>
        {LOCATION_GOVERNANCE_REQUIRED && <p><strong>Controller:</strong> {controller || 'Not yet configured by the project administrator.'}<br /><strong>Privacy contact:</strong> {contact || 'Not yet configured by the project administrator.'}</p>}
        {LOCATION_GOVERNANCE_REQUIRED && governanceLoading && <p role="status" className="rounded-lg bg-neutral-100 p-3 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">Checking published privacy contact details...</p>}
        {LOCATION_GOVERNANCE_REQUIRED && governanceError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">Published privacy details could not be verified. Displayed values may be deployment defaults.</p>}
        {LOCATION_GOVERNANCE_REQUIRED && !governanceLoading && (!controller || !contact) && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Controller and privacy contact details are pending configuration.</p>}
        {LOCATION_GOVERNANCE_REQUIRED && !governanceLoading && !governanceRevision && <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">Location sharing consent is unavailable until published privacy governance details can be verified. You can continue without sharing.</p>}
        <a href="https://privacy.gov.ph/data-privacy-act-/" target="_blank" rel="noreferrer" className="text-red-600 underline">Read the Data Privacy Act of 2012</a>
      </div>
      {storageError && <p role="alert" className="mt-3 text-sm text-red-600">Your choice could not be fully saved or verified. Check your connection and try again. A new grant will not enable location sharing until confirmed by the server.</p>}
      {savingConsent && <p role="status" className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">Saving your consent to the server. Location sharing stays disabled until the server confirms it.</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={onDecline} className="flex-1 rounded-lg border border-neutral-300 px-4 py-3 text-sm font-semibold">{granted ? 'Withdraw consent' : 'Continue without sharing'}</button>
        <button type="button" onClick={onAllow} disabled={savingConsent || (LOCATION_GOVERNANCE_REQUIRED && (governanceLoading || !!governanceError || !governanceRevision))} className="flex-1 rounded-lg bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{savingConsent ? 'Saving consent...' : 'I consent to location sharing'}</button>
        {granted && <button type="button" onClick={onClose} className="w-full text-sm underline">Close notice</button>}
      </div>
    </dialog>
  );
}
