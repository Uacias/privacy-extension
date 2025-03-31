<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
  
	onMount(() => {
	  chrome.storage.local.get(['vault'], (result) => {
		if (!result.vault) {
		  goto('/setup');
		  return;
		}
  
		chrome.storage.session.get(['decryptedSeed'], (session) => {
		  if (session.decryptedSeed) {
			goto('/home');
		  } else {
			goto('/unlock');
		  }
		});
	  });
	});
  </script>
  
  <p>Loading...</p>