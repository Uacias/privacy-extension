// src/background/offscreen.ts
import * as garaga from 'garaga';
import * as bb from '@aztec/bb.js';
import * as noir_import from '@noir-lang/noir_js';
import initACVM from '@noir-lang/acvm_js';
import initNoirC from '@noir-lang/noirc_abi';
import wasmACVM from '@noir-lang/acvm_js/web/acvm_js_bg.wasm?url';
import wasmNoirc from '@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?url';

await garaga.init();
await initACVM(fetch(wasmACVM));
await initNoirC(fetch(wasmNoirc));

console.log('[offscreen] ZK libs initialized ✅');

chrome.runtime.onConnect.addListener((port) => {
	if (port.name !== 'proof-channel') return;
	console.log('[offscreen] 📥 Connected to background via port');

	port.onMessage.addListener(async (msg) => {
		if (msg.type !== 'GENERATE_PROOF') return;

		console.log('[offscreen] 🔧 GENERATE_PROOF received');

		try {
			const { circuit, witnessInput, confirmedOperations = [], pendingOperations = [] } = msg;
			console.log("circuit", circuit);
			console.log("witnessInput", witnessInput);

			const deposits_id = witnessInput.deposits_id;
			const refunds_id = witnessInput.refunds_id;
			const pending = pendingOperations;
			const confirmed = confirmedOperations;
			console.log("confirmed", confirmed);
			console.log("pending", pending);
			delete witnessInput.deposits_id;
			delete witnessInput.refunds_id;
			console.log(deposits_id);
			console.log(deposits_id[0]);

			for (let i = 0; i < deposits_id.length; i++) {
				const depositData = confirmed.find((op: { index: number; }) => op.index === deposits_id[i]);
				console.log("deposit data", depositData);
				const secretHex = `0x${BigInt(depositData.secret).toString(16)}`
				const nullifierHex = `0x${BigInt(depositData.nullifier).toString(16)}`
				witnessInput[`secret_${i + 1}`] = secretHex;
				witnessInput[`nullifier_${i + 1}`] = nullifierHex;
			}

			console.log("witness input", witnessInput)

			for (let i = 0; i < refunds_id.length; i++) {
				const refundData = pending.find((op: { id: string; }) => op.id === refunds_id[i].id);
				console.log(refunds_id[i].id);
				console.log(refundData);
				const secretHex = `0x${BigInt(refundData.secret).toString(16)}`
				const nullifierHex = `0x${BigInt(refundData.nullifier).toString(16)}`
				console.log(refundData.metadata.amount);

				const { displayValue: dispAmount, bigIntValue: amountWeiGaraga } = sanitizeAmount(refundData.metadata.amount, refunds_id[i].decimals);
				const amountHex = `0x${BigInt(amountWeiGaraga).toString(16)}`

				const refundIntermediateHashGaraga = garaga.poseidonHashBN254(
					BigInt(refundData.hash),
					BigInt(amountWeiGaraga)
				);
				const refundCommitmentHashGaraga = garaga.poseidonHashBN254(
					refundIntermediateHashGaraga,
					BigInt(refundData.metadata.tokenAddress)
				);

				const refundCommitmentHashGaragaHex = `0x${refundCommitmentHashGaraga.toString(16)}`

				witnessInput[`refund_secret_${i + 1}`] = secretHex;
				witnessInput[`refund_nullifier_${i + 1}`] = nullifierHex;
				witnessInput[`refund_amount_${i + 1}`] = amountHex;
				witnessInput[`refund_commitment_hash_${i + 1}`] = refundCommitmentHashGaragaHex;
			}

			// Fetch circuit JSON and verifying key from GitHub (or any external URL)
			const program = await fetch(circuit.jsonUrl).then((r) => r.json());
			const vkBin = await fetch(circuit.vkUrl).then((r) => r.arrayBuffer());

			const noir = new noir_import.Noir(program);
			const { witness } = await noir.execute(witnessInput);

			const backend = new bb.UltraHonkBackend(program.bytecode);
			const proof = await backend.generateProof(witness, { keccak: true });

			await backend.verifyProof(proof, { keccak: true });

			const vk = garaga.parseHonkVerifyingKeyFromBytes(new Uint8Array(vkBin));
			const reconstructedProof = bb.reconstructHonkProof(
				flattenFieldsAsArray(proof.publicInputs),
				proof.proof
			);
			const parsedProof = garaga.parseHonkProofFromBytes(reconstructedProof);
			const honkCalldata: Array<BigInt> = garaga.getHonkCallData(parsedProof, vk, 0);

			const honkCalldataHex = [
				`0x` + honkCalldata.length.toString(16),
				...honkCalldata.map((element) => `0x${element.toString(16)}`)
			];

			console.log("honkCalldataHex", honkCalldataHex);

			port.postMessage({ type: 'PROOF_RESPONSE', honkCalldataHex });
		} catch (err: any) {
			console.error('[offscreen] ❌ Proof generation failed:', err);
			port.postMessage({ type: 'PROOF_ERROR', error: err.message || String(err) });
		}
	});
});


export function flattenFieldsAsArray(fields: any) {
	const flattenedPublicInputs = fields.map(hexToUint8Array);
	return flattenUint8Arrays(flattenedPublicInputs);
}

function flattenUint8Arrays(arrays: any) {
	const totalLength = arrays.reduce((acc: any, val: any) => acc + val.length, 0);
	const result = new Uint8Array(totalLength);

	let offset = 0;
	for (const arr of arrays) {
		result.set(arr, offset);
		offset += arr.length;
	}

	return result;
}

function hexToUint8Array(hex: any) {
	const sanitisedHex = BigInt(hex).toString(16).padStart(64, '0');

	const len = sanitisedHex.length / 2;
	const u8 = new Uint8Array(len);

	let i = 0;
	let j = 0;
	while (i < len) {
		u8[i] = parseInt(sanitisedHex.slice(j, j + 2), 16);
		i += 1;
		j += 2;
	}

	return u8;
}

export function sanitizeAmount(value: string, decimals: number) {
	// Remove all characters except digits and dot
	let sanitized = value.replace(/[^0-9.]/g, '');

	// If there are multiple dots, treat the first as the decimal separator and join the rest
	if ((sanitized.match(/\./g) || []).length > 1) {
		const parts = sanitized.split('.');
		sanitized = parts[0] + '.' + parts.slice(1).join('');
	}

	// Remove leading zeros unless the number is less than 1 (i.e., starts with "0.")
	if (sanitized.startsWith('0') && sanitized.length > 1 && sanitized[1] !== '.') {
		sanitized = sanitized.replace(/^0+/, '');
	}

	// If the sanitized result is empty, return empty display and BigInt(0)
	if (sanitized === '') {
		return { displayValue: "", bigIntValue: BigInt("0") };
	}

	// For tokens with 0 decimals, ignore any fractional part
	if (decimals === 0) {
		sanitized = sanitized.split('.')[0];
		return { displayValue: sanitized, bigIntValue: BigInt(sanitized || "0") };
	}

	// For tokens with decimals > 0, allow a fractional part.
	// Limit the fractional part to up to 4 digits, or to the token's decimals if that is less.
	let parts = sanitized.split('.');
	const allowedFractionDigits = decimals < 4 ? decimals : 4;
	if (parts.length === 2) {
		parts[1] = parts[1].slice(0, allowedFractionDigits);
		sanitized = parts.join('.');
	}

	let [integerPart, fractionalPart = ''] = sanitized.split('.');
	// Ensure the integer part is at least "0"
	if (integerPart === '') {
		integerPart = "0";
	}

	// Save the original fractional part (as provided by the user, after limiting but before padding)
	const originalFractionalPart = fractionalPart;

	// For BigInt calculation, pad the fractional part to exactly allowedFractionDigits digits
	const fractionPadded = fractionalPart.padEnd(allowedFractionDigits, '0').slice(0, allowedFractionDigits);
	const fullAmountStr = integerPart + fractionPadded;
	const bigIntValue = BigInt(fullAmountStr) * BigInt(10 ** (decimals - allowedFractionDigits));

	// Determine display value:
	// - If decimals < 4, always pad the fractional part (to exactly 'decimals' digits).
	// - If decimals >= 4, display the fractional part as provided (without extra padding).
	let displayValue;
	if (decimals < 4) {
		displayValue = integerPart + '.' + fractionPadded;
	} else {
		if (sanitized.includes('.')) {
			displayValue = integerPart + (originalFractionalPart !== '' ? '.' + originalFractionalPart : '.');
		} else {
			displayValue = integerPart;
		}
	}

	return { displayValue, bigIntValue };
}