console.log('[inject.js] Running inside page context');

function injectPrivacyAPI() {
	if (window.privacy) return;

	console.log('[inject.js] Injecting window.privacy...');
	window.privacy = {
		request: (payload: any): Promise<any> => {
			return new Promise((resolve) => {
				const id = crypto.randomUUID();

				function handler(event: MessageEvent) {
					if (event.source !== window) return;
					if (event.data?.source !== 'extension-bridge') return;
					if (event.data?.id !== id) return;

					window.removeEventListener('message', handler);
					resolve(event.data.response);
				}

				window.addEventListener('message', handler);

				window.postMessage(
					{
						source: 'my-frontend',
						id,
						payload
					},
					'*'
				);
			});
		}
	};

	console.log('[inject.js] window.privacy ready ✅');
}

injectPrivacyAPI();
