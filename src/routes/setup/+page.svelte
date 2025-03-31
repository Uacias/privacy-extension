<script lang="ts">
	import { generateMnemonic, mnemonicToSeed } from '@scure/bip39';
	import { wordlist } from '@scure/bip39/wordlists/english';
	import { encryptSeed } from '$lib/utils/crypto';

	let password = '';
	let confirmPassword = '';
	let error = '';
	let mnemonic = '';
	let success = false;

	const setupVault = async () => {
		if (password !== confirmPassword || password.length < 6) {
			error = 'Passwords must match and be at least 6 characters';
			return;
		}

		mnemonic = generateMnemonic(wordlist, 256);
		const seed = await mnemonicToSeed(mnemonic);
		const seedHex = Array.from(seed).map(b => b.toString(16).padStart(2, '0')).join('');
		const encrypted = await encryptSeed(seedHex, password);

		chrome.storage.local.set({ vault: encrypted }, () => {
			success = true;
		});
	};
</script>

{#if success}
	<h2>Your mnemonic</h2>
	<pre>{mnemonic}</pre>
	<p>Save it somewhere safe!</p>
{:else}
	<h2>Create Wallet</h2>
	<input type="password" placeholder="Password" bind:value={password} />
	<input type="password" placeholder="Repeat Password" bind:value={confirmPassword} />
	<button on:click={setupVault}>Confirm</button>
	{#if error}<p style="color: red;">{error}</p>{/if}
{/if}
