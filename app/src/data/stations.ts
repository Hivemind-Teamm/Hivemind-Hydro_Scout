'use client';

import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface Station {
  id: string;
  name: string;
  active: boolean;
  aorBarangays?: string[];
}

export function useStations() {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onSnapshot(
    query(collection(db, 'stations'), where('active', '==', true)),
    snapshot => {
      setStations(snapshot.docs.map(record => ({
        id: record.id,
        name: typeof record.data().name === 'string' ? record.data().name : record.id,
        active: true,
        aorBarangays: Array.isArray(record.data().aorBarangays) ? record.data().aorBarangays.filter((value: unknown): value is string => typeof value === 'string') : [],
      })).sort((a, b) => a.name.localeCompare(b.name)));
      setError(null);
      setLoading(false);
    },
    err => {
      console.error('Failed to load stations:', err);
      setError('Could not load the station list. Please try again later.');
      setLoading(false);
    },
  ), []);

  return { stations, loading, error };
}

export async function updateStationAor(id: string, text: string) {
  const aorBarangays = [...new Set(text.split(/[,\n]/).map(value => value.trim()).filter(Boolean))];
  if (aorBarangays.length > 100 || aorBarangays.some(value => value.length > 120)) throw new Error('Use up to 100 barangays, each at most 120 characters.');
  await updateDoc(doc(db, 'stations', id), { aorBarangays });
}

export async function createStation(idInput: string, nameInput: string) {
  const id = idInput.trim();
  const name = nameInput.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Use a Station ID with letters, numbers, underscores, or hyphens.');
  if (!name || name.length > 120) throw new Error('Enter a station name of at most 120 characters.');
  await runTransaction(db, async transaction => {
    const stationRef = doc(db, 'stations', id);
    if ((await transaction.get(stationRef)).exists()) throw new Error('That Station ID already exists.');
    transaction.set(stationRef, { name, active: true, createdAt: serverTimestamp() });
  });
}
