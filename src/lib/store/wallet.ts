import { writable } from 'svelte/store';

export const seedHex = writable<string | null>(null);
export const isUnlocked = writable(false);
