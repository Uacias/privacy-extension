/**
 * Derives a key from a password using PBKDF2
 *
 * @param {string} password
 * @param {Uint8Array} salt
 */
export async function generateKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	const keyMaterial = await window.crypto.subtle.importKey(
		'raw',
		encoder.encode(password),
		'PBKDF2',
		false,
		['deriveKey']
	);

	return window.crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt,
			iterations: 100_000,
			hash: 'SHA-256'
		},
		keyMaterial,
		{
			name: 'AES-GCM',
			length: 256
		},
		false,
		['encrypt', 'decrypt']
	);
}

/**
 * Encrypts a seed using a password and AES-GCM.
 *
 * @param {string} seedHex - The seed to encrypt, as a hexadecimal string.
 * @param {string} password - The password to use for encryption.
 *
 */
export async function encryptSeed(seedHex: string, password: string) {
	const seedBuffer = Uint8Array.from(seedHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
	const salt = window.crypto.getRandomValues(new Uint8Array(16));
	const iv = window.crypto.getRandomValues(new Uint8Array(12));

	const key = await generateKeyFromPassword(password, salt);

	const ciphertext = await window.crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		seedBuffer
	);

	return {
		encryptedSeed: Array.from(new Uint8Array(ciphertext)),
		salt: Array.from(salt),
		iv: Array.from(iv)
	};
}

/**
 * Decrypts an encrypted seed using a password and AES-GCM.
 *
 * @param {{
 *   encryptedSeed: number[],
 *   salt: number[],
 *   iv: number[]
 * }} encryptedSeedObject - An object with the encrypted seed, salt and IV as
 *   arrays of numbers.
 * @param {string} password - The password to use for decryption.
 * 
 */
export async function decryptSeed(
	{ encryptedSeed, salt, iv }: { encryptedSeed: number[]; salt: number[]; iv: number[] },
	password: string
): Promise<string> {
	const key = await generateKeyFromPassword(password, new Uint8Array(salt));

	const decrypted = await window.crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: new Uint8Array(iv) },
		key,
		new Uint8Array(encryptedSeed)
	);

	return Array.from(new Uint8Array(decrypted))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
