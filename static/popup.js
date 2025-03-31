// Function to load pendingProofRequest from chrome.storage (using session or local – in this example session)
function loadPendingProofRequest() {
    return new Promise((resolve, reject) => {
        if (chrome && chrome.storage && chrome.storage.session) {
            chrome.storage.session.get(['pendingProofRequest'], (result) => {
                if (result.pendingProofRequest) {
                    resolve(result.pendingProofRequest);
                } else {
                    reject("No request to approve");
                }
            });
        } else {
            reject("Cannot access chrome.storage");
        }
    });
}

// Function to update the popup UI
function updateUI(pendingProofRequest) {
    const contentDiv = document.getElementById("content");
    contentDiv.innerHTML = `<pre>${JSON.stringify(pendingProofRequest, null, 2)}</pre>`;
}

// Load data when the document is ready
document.addEventListener("DOMContentLoaded", () => {
    loadPendingProofRequest()
        .then((pendingProofRequest) => {
            updateUI(pendingProofRequest);
        })
        .catch((error) => {
            const contentDiv = document.getElementById("content");
            contentDiv.innerHTML = `<p style="color: red;">${error}</p>`;
        });

    // Handle click on "Approve" button
    const approveButton = document.getElementById("approveButton");
    approveButton.addEventListener("click", () => {
        approveButton.disabled = true;
        approveButton.innerText = "Processing...";
        // Send message to background to approve the proof
        chrome.runtime.sendMessage({ type: "APPROVE_PROOF" }, (response) => {
            console.log("Response from APPROVE_PROOF:", response);
            window.close();
        });
    });
});
