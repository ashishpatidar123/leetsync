let syncTriggered = false;
let checkTimeout = null;

function checkForAcceptedSubmission() {
    const spanElements = document.querySelectorAll('span');
    let isAccepted = false;
    
    for (const span of spanElements) {
        if (span.innerText === "Accepted" && span.parentElement && span.parentElement.innerText.includes("Accepted")) {
            isAccepted = true;
            break;
        }
    }

    if (isAccepted && !syncTriggered) {
        syncTriggered = true;
        console.log("LeetCode Syncer: Accepted submission detected!");
        
        const urlParts = window.location.pathname.split('/');
        const problemSlug = urlParts[2];

        if (problemSlug) {
            try {
                // Safely check if the extension context is still alive
                if (chrome.runtime?.id) {
                    chrome.runtime.sendMessage({
                        action: "sync_submission",
                        slug: problemSlug
                    });
                } else {
                    console.warn("LeetCode Syncer: Extension context lost. Please refresh the page.");
                }
            } catch (err) {
                if (err.message.includes("Extension context invalidated")) {
                    console.warn("LeetCode Syncer: Extension was updated/reloaded. Please refresh this LeetCode tab.");
                } else {
                    console.error("LeetCode Syncer Error:", err);
                }
            }
        }

        setTimeout(() => { syncTriggered = false; }, 10000);
    }
}

// Throttled MutationObserver to protect performance on LeetCode's heavy DOM
const observer = new MutationObserver(() => {
    if (checkTimeout) return;
    
    checkTimeout = setTimeout(() => {
        checkForAcceptedSubmission();
        checkTimeout = null;
    }, 1000); // Runs at most once every 1 second
});

observer.observe(document.body, { childList: true, subtree: true });