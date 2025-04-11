import * as garaga from 'garaga';
import initACVM from '@noir-lang/acvm_js';
import initNoirC from '@noir-lang/noirc_abi';
import wasmACVM from '@noir-lang/acvm_js/web/acvm_js_bg.wasm?url';
import wasmNoirc from '@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?url';

async function ensureOffscreenDocument() {
	const offscreenUrl = 'offscreen.html';

	if (!chrome.offscreen) {
		throw new Error('Offscreen API not available.');
	}

	const has = await chrome.offscreen.hasDocument();
	if (has) return;

	await chrome.offscreen.createDocument({
		url: offscreenUrl,
		reasons: [chrome.offscreen.Reason.WORKERS],
		justification: 'Need to run zk-SNARK proof generation with Aztec bb.js in isolated context'
	});
}

const waitForOffscreenReady = () =>
	new Promise<void>((resolve, reject) => {
		let attempts = 0;

		const interval = setInterval(() => {
			attempts++;

			try {
				const port = chrome.runtime.connect({ name: 'proof-channel' });
				port.disconnect();
				clearInterval(interval);
				resolve();
			} catch {
				if (attempts >= 10) {
					clearInterval(interval);
					reject(new Error('Offscreen not ready'));
				}
			}
		}, 200);
	});


console.log('📦 [background] Loaded');
let Noir: any;
let zkContext: {
	garaga: typeof garaga | null;
	ready: boolean;
} = {
	garaga: null,
	ready: false
};


const initZk = async () => {
	if (zkContext.ready) return;

	console.log('🧠 [ZK Init] Starting...');
	try {

		await garaga.init();
		await initACVM(fetch(wasmACVM));
		await initNoirC(fetch(wasmNoirc));

		zkContext.garaga = garaga;
		zkContext.ready = true;
		console.log('✅ [ZK Init] Ready');
	} catch (err) {
		console.error('❌ [ZK Init] Failed:', err);
	}
};

const ensureZkReady = async () => {
	if (!zkContext.ready) await initZk();
};

let pendingProofResponseCallback: ((response: any) => void) | null = null;

// 🔁 Eager init on install (optional)
chrome.runtime.onInstalled.addListener(() => {
	console.log('🔁 [Service Worker] onInstalled');
	initZk();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	console.log('📨 [Message] Received:', msg);

	(async () => {
		// 🧠 Ensure ZK libs are ready
		await ensureZkReady();

		if (msg.type === 'SET_SEED') {
			chrome.storage.session.set({ decryptedSeed: msg.seed }, () => {
				sendResponse({ status: 'ok' });
			});
			return;
		}

		if (msg.type === 'GET_SEED') {
			chrome.storage.session.get(['decryptedSeed'], (res) => {
				sendResponse({ seed: res.decryptedSeed || null });
			});
			return;
		}

		if (msg.type === 'GENERATE_OPERATION') {
			const { metadata } = msg;
			const seedHex = (await chrome.storage.session.get(['decryptedSeed'])).decryptedSeed;

			if (!seedHex) return sendResponse({ error: 'No seed unlocked' });

			const garagaInstance = zkContext.garaga!;
			const seedBigInt = BigInt(`0x${seedHex}`);

			// Fetch all operations
			const allOps = (await chrome.storage.local.get(['confirmedOperations', 'pendingOperations', 'nullifiedOperations', "abortedOperations"]));
			const confirmed = allOps.confirmedOperations || [];
			const pending = allOps.pendingOperations || [];
			const nullified = allOps.nullifiedOperations || [];
			const aborted = allOps.abortedOperations || [];



			const index = confirmed.length + pending.length + nullified.length + aborted.length;
			const id = crypto.randomUUID();

			const secret = garagaInstance.poseidonHashBN254(
				garagaInstance.poseidonHashBN254(seedBigInt, seedBigInt),
				BigInt(index)
			);
			const nullifier = garagaInstance.poseidonHashBN254(secret, secret);
			const hash = garagaInstance.poseidonHashBN254(secret, nullifier);

			const operation = {
				id,
				index,
				secret: secret.toString(),
				nullifier: nullifier.toString(),
				hash: hash.toString(),
				metadata
			};

			// Add to pending
			await chrome.storage.local.set({ pendingOperations: [...pending, operation] });

			sendResponse({ id, hash: operation.hash });
			return;
		}

		if (msg.type === 'IMPORT_OPERATION') {
			const { op } = msg;
			const seedHex = (await chrome.storage.session.get(['decryptedSeed'])).decryptedSeed;

			if (!seedHex) return sendResponse({ error: 'No seed unlocked' });

			const garagaInstance = zkContext.garaga!;
			const seedBigInt = BigInt(`0x${seedHex}`);

			const allOps = (await chrome.storage.local.get(['confirmedOperations', 'pendingOperations', 'nullifiedOperations', "abortedOperations"]));
			const confirmed = allOps.confirmedOperations || [];
			const pending = allOps.pendingOperations || [];
			const nullified = allOps.nullifiedOperations || [];
			const aborted = allOps.abortedOperations || [];

			const index = confirmed.length + pending.length + nullified.length + aborted.length;
			const id = crypto.randomUUID();

			const hash = garagaInstance.poseidonHashBN254(op.secret, op.nullifier);


			const operation = {
				id,
				index,
				secret: op.secret.toString(),
				nullifier: op.nullifier.toString(),
				hash: hash.toString(),
				metadata: op.metadata
			};

			// Add to pending
			await chrome.storage.local.set({ pendingOperations: [...pending, operation] });

			sendResponse({ id, hash: operation.hash });
			return;
		}

		if (msg.type === 'CONFIRM_OPERATION') {
			const { id } = msg;

			const local = await chrome.storage.local.get(['pendingOperations', 'confirmedOperations']);
			const pending = local.pendingOperations || [];
			const confirmed = local.confirmedOperations || [];

			const index = pending.findIndex((op: any) => op?.id === id);
			if (index === -1) return sendResponse({ status: 'error', reason: 'Not found' });

			const [op] = pending.splice(index, 1);
			confirmed.push(op);

			await chrome.storage.local.set({
				pendingOperations: pending,
				confirmedOperations: confirmed
			});

			console.log('[bg] Confirmed:', op);
			sendResponse({ status: 'confirmed' });
			return;
		}

		if (msg.type === 'ABORT_OPERATION') {
			const { id } = msg;

			const local = await chrome.storage.local.get(['pendingOperations', 'abortedOperations']);
			const pending = local.pendingOperations || [];
			const aborted = local.abortedOperations || [];

			const newPending = pending.filter((op: any) => op.id !== id);

			aborted.push(...pending.filter((op: any) => op.id === id));

			await chrome.storage.local.set({ pendingOperations: newPending, abortedOperations: aborted });

			sendResponse({ status: 'aborted' });
			return;
		}

		if (msg.type === 'NULLIFY_OPERATION') {
			const { id } = msg;

			const local = await chrome.storage.local.get(['confirmedOperations', 'nullifiedOperations']);
			const nullified = local.nullifiedOperations || [];
			const confirmed = local.confirmedOperations || [];

			const newConfirmed = confirmed.filter((op: any) => op.id !== id);
			const newNullified = [...nullified, ...confirmed.filter((op: any) => op.id === id)];

			await chrome.storage.local.set({ confirmedOperations: newConfirmed, nullifiedOperations: newNullified });

			sendResponse({ status: 'nullified' });
			return;
		}

		if (msg.type === 'GET_CONFIRMED_OPERATIONS') {
			chrome.storage.session.get(['decryptedSeed'], (res) => {
				const seedHex = res.decryptedSeed;
				if (!seedHex) {
					return sendResponse({ error: 'No seed unlocked' });
				}
				chrome.storage.local.get(['confirmedOperations'], (res) => {
					sendResponse({
						operations: res.confirmedOperations || []
					});
				});
				return true;
			});

		}

		if (msg.type === 'GET_PENDING_OPERATIONS') {
			chrome.storage.session.get(['decryptedSeed'], (res) => {
				const seedHex = res.decryptedSeed;
				if (!seedHex) {
					return sendResponse({ error: 'No seed unlocked' });
				}
				chrome.storage.local.get(['pendingOperations'], (res) => {
					sendResponse({
						operations: res.pendingOperations || []
					});
				});
				return true;
			});

		}

		if (msg.type === 'EXECUTE_TRANSACTION') {
			const { body } = msg;

			try {
				const executeTransactionResponse = await fetch(`https://privacypoolsstaging.visoft.dev/asp/executeAccountTransaction`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body
				});

				if (!executeTransactionResponse.ok) {
					let fullMessage = 'Unknown error';
					try {
						const errorJson = await executeTransactionResponse.json();
						const { code, message } = errorJson;
						fullMessage = `[${code}] ${message}`;
					} catch (parseError) {
						fullMessage = 'Error while executing transaction.';
					}
					sendResponse({ error: fullMessage });
					return;
				}

				const txnData = await executeTransactionResponse.json();
				const transactionHash = txnData.transaction_hash;

				sendResponse({ hash: transactionHash });
			} catch (networkError) {
				sendResponse({ error: 'Network error or backend unavailable.' });
			}
			return;
		}

		if (msg.type === 'GET_PROOF_DATA') {
			const { body } = msg;

			try {
				const getProofDataResponse = await fetch(`https://privacypoolsstaging.visoft.dev/asp/getProofData`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body
				});

				if (!getProofDataResponse.ok) {
					let message = 'Error while fetching proof data. Make sure the passed data is correct or try again later.'
					sendResponse({ error: message });
					return;
				}

				const proofData = await getProofDataResponse.json();
				sendResponse({ data: proofData });
			} catch (networkError) {
				sendResponse({ error: 'Network error or backend unavailable.' });
			}
			return;
		}

		if (msg.type === 'GET_TRANSACTION_FEE_DATA') {
			const { body } = msg;

			try {
				const feeResponse = await fetch(`https://privacypoolsstaging.visoft.dev/asp/getTransactionFee`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body
				});

				if (!feeResponse.ok) {
					let message = 'Failed to fetch withdraw fee.'
					sendResponse({ error: message });
					return;
				}

				const feeData = await feeResponse.json();
				sendResponse({ data: feeData });
			} catch (networkError) {
				sendResponse({ error: 'Network error or backend unavailable.' });
			}
			return;
		}

		if (msg.type === 'GET_TOKEN_DECIMALS') {
			const { tokenAddress } = msg;

			try {
				const response = await fetch(`https://privacypoolsstaging.visoft.dev/asp/getTokenDecimals`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token_address: tokenAddress })
				});

				if (!response.ok) {
					let message = 'Failed to fetch token decimals.'
					sendResponse({ error: message });
					return;
				}

				const tokenDecimals = await response.json();
				sendResponse({ data: tokenDecimals });
			} catch (networkError) {
				sendResponse({ error: 'Network error or backend unavailable.' });
			}
			return;
		}

		if (msg.type === 'GET_TOKEN_NAME') {
			const { tokenAddress } = msg;

			try {
				const response = await fetch(`https://privacypoolsstaging.visoft.dev/asp/getTokenName`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token_address: tokenAddress }),
				});

				if (!response.ok) {
					let message = 'Failed to fetch token name.'
					sendResponse({ error: message });
					return;
				}

				const tokenName = await response.json();
				sendResponse({ data: tokenName });
			} catch (networkError) {
				sendResponse({ error: 'Network error or backend unavailable.' });
			}
			return;
		}

		if (msg.type === 'GENERATE_PROOF') {
			await ensureOffscreenDocument();
			await waitForOffscreenReady();
			const requestId = crypto.randomUUID();
			const local = await chrome.storage.local.get(['pendingOperations', 'confirmedOperations']);
			const pending = local.pendingOperations || [];
			const confirmed = local.confirmedOperations || [];

			const pendingProof = {
				type: 'GENERATE_PROOF',
				circuit: msg.circuit,
				witnessInput: msg.witnessInput,
				confirmedOperations: confirmed,
				pendingOperations: pending,
			};

			await chrome.storage.session.set({ pendingProofRequest: pendingProof });
			console.log('[background] 📥 Stored pendingProofRequest in session');

			await chrome.action.setPopup({ popup: 'popup.html' });
			chrome.action.openPopup();

			pendingProofResponseCallback = sendResponse;
			return true;
		}

		if (msg.type === 'APPROVE_PROOF') {
			chrome.storage.session.get(['pendingProofRequest'], async (result) => {
				const pending = result.pendingProofRequest;
				if (!pending) {
					if (pendingProofResponseCallback) {
						pendingProofResponseCallback({ error: 'No request found' });
						pendingProofResponseCallback = null;
					}
					chrome.action.setPopup({ popup: 'index.html' });
					return;
				}
				chrome.storage.session.remove('pendingProofRequest', async () => {
					try {
						await ensureOffscreenDocument();
						await waitForOffscreenReady();
						const port = chrome.runtime.connect({ name: 'proof-channel' });
						port.postMessage({
							type: 'GENERATE_PROOF',
							circuit: pending.circuit,
							witnessInput: pending.witnessInput,
							confirmedOperations: pending.confirmedOperations,
							pendingOperations: pending.pendingOperations,
						});
						port.onMessage.addListener((response) => {
							if (response.type === 'PROOF_RESPONSE') {
								if (pendingProofResponseCallback) {
									pendingProofResponseCallback({ proof: response.honkCalldataHex });
									pendingProofResponseCallback = null;
								}
								chrome.action.setPopup({ popup: 'index.html' });
							} else if (response.type === 'PROOF_ERROR') {
								if (pendingProofResponseCallback) {
									pendingProofResponseCallback({ error: response.error });
									pendingProofResponseCallback = null;
								}
								chrome.action.setPopup({ popup: 'index.html' });
							}
						});
					} catch (err: any) {
						if (pendingProofResponseCallback) {
							pendingProofResponseCallback({ error: err.message || String(err) });
							pendingProofResponseCallback = null;
						}
						chrome.action.setPopup({ popup: 'index.html' });
					}
				});
			});
			return true;
		}

	})();

	return true;
});


