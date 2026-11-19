'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  savePrivacyGovernance,
  usePrivacyGovernance,
  validatePrivacyGovernance,
  type PrivacyGovernance,
} from '@/lib/privacy-governance';

export default function PrivacyGovernanceCard() {
  const { user, role, accountType } = useAuth();

  const {
    settings,
    loading,
    error,
    configured,
  } = usePrivacyGovernance();

  // A null draft means the form displays the latest Firestore values.
  // Once editing begins, a separate draft preserves unsaved changes.
  const [draft, setDraft] = useState<PrivacyGovernance | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const form = draft ?? settings;

  const dirty =
    draft !== null &&
    (
      draft.controller !== settings.controller ||
      draft.contact !== settings.contact
    );

  const canEdit =
    !!user &&
    role === 'admin' &&
    accountType !== 'station';

  const validationError = dirty
    ? validatePrivacyGovernance(form)
    : null;

  function updateField(
    field: keyof PrivacyGovernance,
    value: string,
  ) {
    setDraft(current => ({
      ...(current ?? settings),
      [field]: value,
    }));

    setMessage(null);
    setSaveError(null);
  }

  function reset() {
    setDraft(null);
    setMessage(null);
    setSaveError(null);
  }

  async function save() {
    if (
      !canEdit ||
      !user ||
      saving ||
      loading ||
      error ||
      !dirty
    ) {
      return;
    }

    const problem = validatePrivacyGovernance(form);

    if (problem) {
      setSaveError(problem);
      return;
    }

    setSaving(true);
    setMessage(null);
    setSaveError(null);

    try {
      await savePrivacyGovernance(form, user.uid);

      setDraft(null);
      setMessage('Privacy governance settings saved successfully.');
    } catch (cause) {
      setSaveError(
        cause instanceof Error
          ? cause.message
          : 'Could not save privacy settings.',
      );
    } finally {
      setSaving(false);
    }
  }

  const inputClass = [
    'w-full rounded-lg border border-neutral-300',
    'bg-white px-3 py-2 text-sm text-neutral-900',
    'outline-none focus:border-blue-500',
    'focus:ring-2 focus:ring-blue-500/20',
    'disabled:cursor-not-allowed disabled:opacity-60',
    'dark:border-neutral-700 dark:bg-neutral-800',
    'dark:text-neutral-100',
  ].join(' ');

  return (
    <section className="w-full rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-lg font-extrabold text-neutral-800 dark:text-neutral-100">
        Privacy Governance
      </h2>

      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        Configure the responsible organization and privacy contact shown
        in the HydroScout location consent notice.
      </p>

      {loading && (
        <p role="status" className="mt-4 text-sm">
          Loading privacy governance settings...
        </p>
      )}

      {!loading && !configured && !error && (
        <p className="mt-4 text-xs text-amber-700 dark:text-amber-300">
          No saved settings found. Environment values are displayed
          as defaults.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error} Saving is unavailable until settings can be loaded.
        </p>
      )}

      <div className="mt-5 grid gap-5">
        <label className="flex flex-col gap-2 text-sm font-bold text-neutral-700 dark:text-neutral-200">
          Data controller

          <input
            value={form.controller}
            onChange={event =>
              updateField('controller', event.target.value)
            }
            maxLength={120}
            disabled={!canEdit || loading || saving || !!error}
            placeholder="Responsible organization"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-bold text-neutral-700 dark:text-neutral-200">
          Privacy contact

          <input
            value={form.contact}
            onChange={event =>
              updateField('contact', event.target.value)
            }
            maxLength={254}
            disabled={!canEdit || loading || saving || !!error}
            placeholder="Privacy officer email or contact details"
            className={inputClass}
          />
        </label>
      </div>

      {validationError && (
        <p role="alert" className="mt-4 text-sm text-amber-700">
          {validationError}
        </p>
      )}

      {saveError && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {saveError}
        </p>
      )}

      {message && (
        <p role="status" className="mt-4 text-sm text-emerald-700">
          {message}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={
            !canEdit ||
            loading ||
            saving ||
            !dirty ||
            !!error ||
            !!validationError
          }
          onClick={() => void save()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>

        <button
          type="button"
          disabled={saving || !dirty}
          onClick={reset}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
        >
          Reset
        </button>
      </div>

      <p className="mt-5 text-xs text-neutral-500 dark:text-neutral-400">
        These settings identify the responsible organization and privacy
        contact. They do not establish a data retention policy, replace
        required privacy procedures, or certify legal compliance.
      </p>
    </section>
  );
}
