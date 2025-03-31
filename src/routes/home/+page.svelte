<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { seedHex, isUnlocked } from '$lib/store/wallet';
	import { get } from 'svelte/store';
	import { reconstructHonkProof, type ProofData } from '@aztec/bb.js';

	let seed: string | null = null;
	let amount = '';
	let tokenAddress = '';
	let generated: any = null;
	let proof: ProofData | null = null;

	onMount(() => {
		const current = get(seedHex);
		if (current) {
			seed = current;
			return;
		}

		chrome.runtime.sendMessage({ type: 'GET_SEED' }, (res) => {
			if (res?.seed) {
				seedHex.set(res.seed);
				seed = res.seed;
			} else {
				goto('/unlock');
			}
		});
	});

	const logout = () => {
		seedHex.set(null);
		isUnlocked.set(false);
		chrome.runtime.sendMessage({ type: 'SET_SEED', seed: null }, () => goto('/unlock'));
	};
</script>

<h2>Wallet Seed</h2>
<pre>{seed}</pre>

<hr />
<button on:click={logout}>🚪 Logout</button>
