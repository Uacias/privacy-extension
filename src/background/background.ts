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
			const allOps = (await chrome.storage.local.get(['confirmedOperations', 'pendingOperations']));
			const confirmed = allOps.confirmedOperations || [];
			const pending = allOps.pendingOperations || [];

			const index = confirmed.length + pending.length;
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

			const local = await chrome.storage.local.get(['pendingOperations']);
			const pending = local.pendingOperations || [];

			const newPending = pending.filter((op: any) => op.id !== id);

			await chrome.storage.local.set({ pendingOperations: newPending });

			sendResponse({ status: 'aborted' });
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

		// if (msg.type === 'GENERATE_PROOF') {
		// 	await ensureOffscreenDocument();
		// 	await waitForOffscreenReady();

		// 	const port = chrome.runtime.connect({ name: 'proof-channel' });
		// 	const local = await chrome.storage.local.get(['pendingOperations', 'confirmedOperations']);
		// 	const pending = local.pendingOperations || [];
		// 	const confirmed = local.confirmedOperations || [];

		// 	port.postMessage({
		// 		type: 'GENERATE_PROOF',
		// 		circuit: msg.circuit,
		// 		witnessInput: msg.witnessInput,
		// 		confirmedOperations: confirmed,
		// 		pendingOperations: pending,
		// 	});

		// 	port.onMessage.addListener((response) => {
		// 		if (response.type === 'PROOF_RESPONSE') {
		// 			sendResponse({ proof: response.honkCalldataHex });
		// 		} else if (response.type === 'PROOF_ERROR') {
		// 			sendResponse({ error: response.error });
		// 		}
		// 	});

		// 	return true;
		// }
		// GENERATE_PROOF: zapisujemy żądanie i otwieramy popup
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
								// Resetuj popup po zakończeniu operacji
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

		// if (msg.type === 'GENERATE_PROOF') {
		// 	const requestId = crypto.randomUUID();

		// 	const pending = {
		// 		id: requestId,
		// 		circuit: msg.circuit,
		// 		witnessInput: msg.witnessInput
		// 	};

		// 	await chrome.storage.session.set({ pendingProofRequest: pending });

		// 	console.log('[background] 📥 Stored pendingProofRequest in session');

		// 	// ✅ Skonfiguruj popup jako approve-proof.html
		// 	await chrome.action.setPopup({ popup: 'xd.html' });
		// 	chrome.action.openPopup();

		// 	// Poinformuj frontend, że popup został otwarty
		// 	sendResponse({ status: 'waiting_for_approval', requestId });

		// 	return true;
		// }



	})();


	// ✅ Inform Chrome that we’ll respond asynchronously
	return true;
});


