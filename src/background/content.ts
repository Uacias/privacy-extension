console.log('🧩 [content.js] Injecting Privacy API...');

// Inject inject.js script tag into the actual page
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.type = 'module';
script.onload = () => {
	console.log('✅ [content.js] inject.js loaded');
	script.remove(); // Optional: clean up
};
(document.head || document.documentElement).appendChild(script);

console.log('📡 [content.js] Setting up message bridge...');

// Handle messages from frontend
window.addEventListener('message', (event) => {
	if (event.source !== window) return;
	if (!event.data || event.data.source !== 'my-frontend') return;

	const msg = event.data.payload;
	console.log('➡️ [content.js] Forwarding message to background:', msg);

	chrome.runtime.sendMessage(msg, (response) => {
		console.log('⬅️ [content.js] Got response from background:', response);

		window.postMessage(
			{
				source: 'extension-bridge',
				response,
				id: event.data.id
			},
			'*'
		);
	});
});
