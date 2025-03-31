export {};

declare global {
	interface PrivacyAPI {
		request: (payload: any) => Promise<any>;
	}

	interface Window {
		privacy?: PrivacyAPI;
	}
}
