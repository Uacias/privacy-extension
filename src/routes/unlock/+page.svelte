<script lang="ts">
	import { decryptSeed } from '$lib/utils/crypto';
	import { goto } from '$app/navigation';
	import { seedHex, isUnlocked } from '$lib/store/wallet';

	let password = '';
	let error = '';

	const unlock = () => {
		chrome.storage.local.get(['vault'], async (result) => {
			const vault = result.vault;
			if (!vault) {
				error = 'Vault does not exist.';
				return;
			}
			try {
				const decrypted = await decryptSeed(vault, password);
				chrome.runtime.sendMessage({ type: 'SET_SEED', seed: decrypted }, (res) => {
					if (res?.status === 'ok') {
						seedHex.set(decrypted);
						isUnlocked.set(true);
						goto('/home');
					} else {
						error = 'Error communicating with background';
					}
				});
			} catch {
				error = 'Invalid password';
			}
		});
	};
</script>

<h2>Unlock Wallet</h2>
<input type="password" bind:value={password} placeholder="Password" />
<button on:click={unlock}>Unlock</button>
{#if error}<p style="color: red;">{error}</p>{/if}
