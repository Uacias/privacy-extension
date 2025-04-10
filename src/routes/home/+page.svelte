<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { seedHex, isUnlocked } from '$lib/store/wallet';
	import { get } from 'svelte/store';
	import { reconstructHonkProof, type ProofData } from '@aztec/bb.js';
	let seed: string | null = null;

	let secret: string | null = null;
	let nullifier: string | null = null;

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

		chrome.storage.session.get('formData', (result) => {
			if (result.formData) {
				secret = result.formData.secret || '';
				nullifier = result.formData.nullifier || '';
				amount = result.formData.amount || '';
				tokenAddress = result.formData.tokenAddress || '';
			}
		});
	});

	const saveFormData = () => {
		chrome.storage.session.set({
			formData: {
				secret,
				nullifier,
				amount,
				tokenAddress
			}
		});
	};

	const importTransfer = async () => {
		if (!secret || !nullifier || !tokenAddress || !amount) {
			alert('Please enter amount, token address, secret and nullifier');
			return;
		}

		const op = {
			secret: secret.toString(),
			nullifier: nullifier.toString(),
			metadata: { amount, tokenAddress, type: 'deposit' }
		};
		chrome.runtime.sendMessage(
			{
				type: 'IMPORT_OPERATION',
				op
			},
			(res) => {
				if (res?.hash) {
					generated = {
						id: res.id,
						hash: res.hash,
						metadata: { amount, tokenAddress, type: 'deposit' },
						status: 'pending'
					};
				}
			}
		);
	};

	const confirmOperation = (id: number) => {
		chrome.runtime.sendMessage({ type: 'CONFIRM_OPERATION', id }, (res) => {
			if (generated) generated.status = res.status;
			chrome.storage.session.remove('formData', () => {
				console.log('Form data cleared from session');
			});
		});
	};

	const abortOperation = (id: number) => {
		chrome.runtime.sendMessage({ type: 'ABORT_OPERATION', id }, (res) => {
			if (generated) generated.status = res.status;
			chrome.storage.session.remove('formData', () => {
				console.log('Form data cleared from session');
			});
		});
	};
	const clearInputs = () => {
		chrome.storage.session.remove('formData', () => {
			console.log('Form data cleared from session');
		});
		secret = '';
		nullifier = '';
		amount = '';
		tokenAddress = '';
	};

	const logout = () => {
		seedHex.set(null);
		isUnlocked.set(false);
		chrome.runtime.sendMessage({ type: 'SET_SEED', seed: null }, () => goto('/unlock'));
	};
</script>

<h2>Wallet Seed</h2>
<pre>{seed}</pre>

<hr />

<h3>Transfer Information</h3>
<div>
	<label for="amount">Amount:</label>
	<input placeholder="Amount" bind:value={amount} on:input={saveFormData} />

	<label for="tokenAddress">Token Address:</label>
	<input placeholder="Token Address" bind:value={tokenAddress} on:input={saveFormData} />

	<label for="secret">Secret:</label>
	<input
		id="secret"
		type="text"
		bind:value={secret}
		placeholder="Enter secret"
		on:input={saveFormData}
	/>

	<label for="nullifier">Nullifier:</label>
	<input
		id="nullifier"
		type="text"
		bind:value={nullifier}
		placeholder="Enter nullifier"
		on:input={saveFormData}
	/>
</div>

<button on:click={importTransfer}>Import Transfer</button>
<button on:click={clearInputs}>Clear Inputs</button>

<hr />

{#if generated}
	<h4>Operation Preview</h4>
	<pre>{JSON.stringify(generated, null, 2)}</pre>
	<button on:click={() => confirmOperation(generated.id)}>✅ Confirm</button>
	<button on:click={() => abortOperation(generated.id)}>❌ Abort</button>
{/if}

<button on:click={logout}>🚪 Logout</button>

<style>
	div {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	button {
		display: inline-block;
		margin-top: 10px;
	}
</style>
