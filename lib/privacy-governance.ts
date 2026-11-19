'use client';

import { useEffect, useState } from 'react';
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface PrivacyGovernance {
  controller: string;
  contact: string;
}

export interface PrivacyGovernanceState {
  settings: PrivacyGovernance;
  loading: boolean;
  error: string | null;
  configured: boolean;
  revision: string | null;
  publishedAt: Timestamp | null;
}

export const PRIVACY_GOVERNANCE_FALLBACK: PrivacyGovernance = {
  controller: process.env.NEXT_PUBLIC_LOCATION_PRIVACY_CONTROLLER?.trim() ?? '',
  contact: process.env.NEXT_PUBLIC_LOCATION_PRIVACY_CONTACT?.trim() ?? '',
};

export function validatePrivacyGovernance(
  settings: PrivacyGovernance,
): string | null {
  const controller = settings.controller.trim();
  const contact = settings.contact.trim();

  if (!controller || controller.length > 120) {
    return 'Data controller must contain 1 to 120 characters.';
  }

  if (!contact || contact.length > 254) {
    return 'Privacy contact must contain 1 to 254 characters.';
  }

  return null;
}

export function usePrivacyGovernance(): PrivacyGovernanceState {
  const [state, setState] = useState<PrivacyGovernanceState>({
    settings: PRIVACY_GOVERNANCE_FALLBACK,
    loading: true,
    error: null,
    configured: false,
    revision: null,
    publishedAt: null,
  });

  useEffect(() => {
    return onSnapshot(
      doc(db, 'appSettings', 'locationPrivacy'),
      { includeMetadataChanges: true },
      snapshot => {
        // A cached snapshot or local pending write is not verification
        // that these details are currently published on the server.
        if (snapshot.metadata.fromCache ||
            snapshot.metadata.hasPendingWrites) {
          setState(previous => ({
            ...previous,
            loading: true,
            revision: null,
            publishedAt: null,
          }));
          return;
        }

        if (!snapshot.exists()) {
          setState({
            settings: PRIVACY_GOVERNANCE_FALLBACK,
            loading: false,
            error: null,
            configured: false,
            revision: null,
            publishedAt: null,
          });
          return;
        }

        const data = snapshot.data();
        const controller = typeof data.controller === 'string'
          ? data.controller.trim()
          : '';
        const contact = typeof data.contact === 'string'
          ? data.contact.trim()
          : '';

        const publishedAt = data.updatedAt instanceof Timestamp
          ? data.updatedAt
          : null;

        const revision = publishedAt
          ? `published:${publishedAt.seconds}:${publishedAt.nanoseconds}`
          : null;

        if (validatePrivacyGovernance({ controller, contact }) ||
            !revision) {
          setState({
            settings: PRIVACY_GOVERNANCE_FALLBACK,
            loading: false,
            error: 'Saved privacy settings are invalid or missing a server revision.',
            configured: false,
            revision: null,
            publishedAt: null,
          });
          return;
        }

        setState({
          settings: { controller, contact },
          loading: false,
          error: null,
          configured: true,
          revision,
          publishedAt,
        });
      },
      error => {
        console.error('Could not load privacy governance settings:', error);
        setState({
          settings: PRIVACY_GOVERNANCE_FALLBACK,
          loading: false,
          error: 'Could not load saved privacy settings.',
          configured: false,
          revision: null,
          publishedAt: null,
        });
      },
    );
  }, []);

  return state;
}

export async function savePrivacyGovernance(
  settings: PrivacyGovernance,
  adminUid: string,
): Promise<void> {
  const validationError = validatePrivacyGovernance(settings);

  if (validationError) {
    throw new Error(validationError);
  }

  if (!adminUid.trim()) {
    throw new Error('An authenticated Admin account is required.');
  }

  await setDoc(doc(db, 'appSettings', 'locationPrivacy'), {
    controller: settings.controller.trim(),
    contact: settings.contact.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  });
}
