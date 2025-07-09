// popup.js
// Helper function to sanitize a string for use as a filename
function sanitizeFilename(title) {
    console.log('popup.js: sanitizeFilename - Sanitizing title:', title);
    // Replace invalid characters with an underscore
    return title.replace(/[/\\?%*:|"<>]/g, '_')
                .replace(/\s+/g, '_') // Replace spaces with underscores
                .toLowerCase(); // Convert to lowercase for consistency
}

document.addEventListener('DOMContentLoaded', async () => {
    // Create debug panel FIRST so it exists for all updates
    const resultDiv = document.getElementById('result');

    // No initial delay
    console.log('popup.js: DOMContentLoaded - Popup script started.');
    // Do not call logToPageConsole here; only call after content script is injected

    const startAutomationBtn = document.getElementById('startAutomationBtn');
    const abortSearchBtn = document.getElementById('abortSearchBtn');
    const savePrefixInput = document.getElementById('savePrefix');
    const pauseDurationInput = document.getElementById('pauseDuration'); // Added to fix ReferenceError

    let cachedTitlesFromSearchResults = []; // To store titles retrieved from search results for automation

    // Utility to show/hide and reset abort button state
    function setAbortButtonVisible(visible) {
        if (visible) {
            abortSearchBtn.classList.remove('hidden');
            abortSearchBtn.style.display = '';
            abortSearchBtn.setAttribute('aria-hidden', 'false');
            abortSearchBtn.tabIndex = 0;
            abortSearchBtn.disabled = false;
        } else {
            abortSearchBtn.classList.add('hidden');
            abortSearchBtn.style.display = 'none';
            abortSearchBtn.setAttribute('aria-hidden', 'true');
            abortSearchBtn.tabIndex = -1;
            abortSearchBtn.disabled = false; // Always reset to enabled when hidden
        }
    }

    // Function to initialize the popup state, including setting the default prefix
    async function initializePopup() {
        console.log('popup.js: initializePopup - Starting initialization.');
        resultDiv.textContent = 'Verifying current tab...';
        resultDiv.className = 'result-box info';
        startAutomationBtn.classList.add('hidden'); // Ensure hidden initially
        setAbortButtonVisible(false); // Hide and reset abort button

        // Set default value for savePrefixInput before any search
        // Compute the prefix from the search string if available in the DOM
        let searchString = '';
        const pageText = document.body.innerText;
        const regex = /results for\s+(?:["“])?(.+?)(?:["”])?(?:$|\s)/i;
        const match = pageText.match(regex);
        if (match && match[1]) {
            searchString = match[1].trim();
        }
        console.log('popup.js: Computed searchString:', searchString);
        // Do NOT call logToPageConsole here; only after content script is injected
        if (searchString) {
            savePrefixInput.value = sanitizeFilename(searchString, false) + '/'; // Don't log to page here
        } else {
            savePrefixInput.value = '';
        }
        console.log('popup.js: savePrefixInput.value after initialization:', savePrefixInput.value);
        // Do NOT call logToPageConsole here; only after content script is injected

        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('popup.js: initializePopup - Current tab queried:', tab);

        if (tab && tab.url) {
            const targetURL = 'https://gemini.google.com/search';
            if (tab.url.startsWith(targetURL)) {
                console.log('popup.js: initializePopup - Current tab is Gemini search page.');
                resultDiv.textContent = `Gemini search page detected. Checking content...`;
                resultDiv.classList.add('info');
                setAbortButtonVisible(true);

                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                }, async () => {
                    if (chrome.runtime.lastError) {
                        console.error('popup.js: initializePopup - Script injection error:', chrome.runtime.lastError);
                        resultDiv.textContent = `Error injecting script: ${chrome.runtime.lastError.message}`;
                        resultDiv.classList.add('failure');
                        savePrefixInput.value = 'gemini_transcripts/'; // Fallback
                        setAbortButtonVisible(false);
                        return;
                    }
                    console.log('popup.js: initializePopup - content.js injected. Sending "searchPageContent" message.');
                    chrome.tabs.sendMessage(tab.id, { action: "searchPageContent" });
                });
            } else {
                console.log('popup.js: initializePopup - Current tab is NOT Gemini search page.');
                resultDiv.textContent = `Current tab is not a Gemini search results page. Please navigate to ${targetURL}.`;
                resultDiv.classList.add('failure');
                savePrefixInput.value = 'gemini_transcripts/'; // Default fallback
            }
        } else {
            console.log('popup.js: initializePopup - Could not get current tab URL.');
            resultDiv.textContent = 'Could not get current tab URL.';
            resultDiv.classList.add('failure');
            savePrefixInput.value = 'gemini_transcripts/'; // Default fallback
        }
        console.log('popup.js: initializePopup - Initialization finished.');
    }

    // Call initializePopup when the DOM is loaded
    initializePopup();

    // Event listener for the "Extract Transcripts" button
    startAutomationBtn.addEventListener('click', async () => {
        console.log('popup.js: "Extract Transcripts" button clicked.');
        let savePrefix = savePrefixInput.value.trim();
        // Ensure the prefix ends with a slash if it's not empty
        if (savePrefix && !savePrefix.endsWith('/')) {
            savePrefix += '/';
        }
        // Basic validation for the save prefix
        if (!savePrefix) {
            resultDiv.textContent = 'Please enter a Transcript File Prefix before starting automation.';
            resultDiv.classList.add('failure');
            return;
        }

        let pauseDuration = parseFloat(pauseDurationInput.value);
        // Changed validation to allow 0 or positive numbers
        if (isNaN(pauseDuration) || pauseDuration < 0) {
            resultDiv.textContent = 'Please enter a valid non-negative number for Pause Duration.';
            resultDiv.classList.add('failure');
            return;
        }

        startAutomationBtn.disabled = true; // Disable this button once clicked
        setAbortButtonVisible(false); // Hide abort button during automation

        resultDiv.textContent = 'Starting automation...';
        resultDiv.classList.add('info');

        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            console.log('popup.js: Sending "startAutomation" message to content.js with pauseDuration:', pauseDuration);
            // Send a message to content.js to start the automation process
            // Pass both savePrefix and pauseDuration to the content script
            chrome.tabs.sendMessage(tab.id, {
                action: "startAutomation",
                savePrefix: savePrefix,
                pauseDuration: pauseDuration * 1000 // Convert seconds to milliseconds
            });
        }
    });

    // Event listener for the "Abort Search" button
    abortSearchBtn.addEventListener('click', async () => {
        console.log('popup.js: "Abort Search" button clicked.');
        abortSearchBtn.disabled = true; // Disable to prevent multiple clicks
        resultDiv.textContent = 'Aborting search...';
        resultDiv.classList.add('info');

        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, { action: "abortSearch" });
        }
    });


    // Listener for messages coming from the content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('popup.js: Received message from content.js:', request.action, request);

        if (request.action === "searchResults") {
            // Hide abort button after initial search results are processed
            setAbortButtonVisible(false);

            // Clear the search status message when results are in
            resultDiv.textContent = '';

            if (request.found) {
                console.log('popup.js: searchResults - Pattern found. Search string:', request.searchString);
                // Set the default value of the savePrefix input to the search string
                if (request.searchString) {
                    savePrefixInput.value = sanitizeFilename(request.searchString) + '/';
                } else {
                    savePrefixInput.value = 'gemini_transcripts/'; // Default fallback
                }

                if (request.allTitlesMatched) {
                    resultDiv.textContent = `Page verified. ${request.titles.length} search results found and matched in conversation list. Ready to extract.`;
                    resultDiv.classList.add('success');
                    if (request.titles.length > 0) {
                        startAutomationBtn.classList.remove('hidden');
                        startAutomationBtn.disabled = false;
                    }
                } else {
                    resultDiv.textContent = `Page verified, but not all search results matched in conversation list. Automation may not be complete.`;
                    resultDiv.classList.add('failure');
                    startAutomationBtn.classList.add('hidden');
                }
            } else {
                console.log('popup.js: searchResults - Pattern NOT found.');
                resultDiv.textContent = `Gemini search page detected, but the search results pattern was not found.`;
                resultDiv.classList.add('failure');
                startAutomationBtn.classList.add('hidden');
                savePrefixInput.value = 'gemini_transcripts/'; // Default fallback if no search string
            }
        } else if (request.action === "processingTitle") {
            console.log('popup.js: processingTitle - Currently processing:', request.title);
            resultDiv.textContent = `Extracting: "${request.title}" (${request.current} of ${request.total})...`;
            resultDiv.classList.add('info');
            startAutomationBtn.classList.add('hidden');
            setAbortButtonVisible(false);
            // Ensure hidden during processing
            // Remove: searchStatusDiv.classList.add('hidden');
        } else if (request.action === "automationComplete") {
            console.log('popup.js: automationComplete - All conversations processed. Transcripts received:', request.transcripts.length);
            resultDiv.textContent = request.message || 'Automation complete!';
            resultDiv.classList.add('success');
            startAutomationBtn.classList.add('hidden');
            setAbortButtonVisible(false); // Only use the robust utility

            if (request.transcripts && request.transcripts.length > 0) {
                console.log('popup.js: automationComplete - Initiating downloads for', request.transcripts.length, 'transcripts.');
                resultDiv.textContent += `<br>Initiating downloads for ${request.transcripts.length} transcripts...`;
                resultDiv.classList.add('info');

                const currentSavePrefix = savePrefixInput.value.trim();
                const targetSearchURL = 'https://gemini.google.com/search'; // Define target URL here

                request.transcripts.forEach((transcriptData, index) => {
                    const filename = currentSavePrefix + sanitizeFilename(transcriptData.title) + '.txt';
                    const blob = new Blob([transcriptData.content], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);

                    chrome.downloads.download({
                        url: url,
                        filename: filename,
                        saveAs: true
                    }, (downloadId) => {
                        if (chrome.runtime.lastError) {
                            console.error(`popup.js: Download failed for "${transcriptData.title}":`, chrome.runtime.lastError.message);
                        } else {
                            console.log(`popup.js: Download started for ${filename}, ID: ${downloadId}`);
                        }
                        URL.revokeObjectURL(url);
                    });
                });

                // After all downloads are initiated, explicitly navigate the tab back to the search page
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0] && !tabs[0].url.startsWith(targetSearchURL)) {
                        console.log('popup.js: automationComplete - Navigating tab back to search page:', targetSearchURL);
                        chrome.tabs.update(tabs[0].id, { url: targetSearchURL });
                    } else {
                        console.log('popup.js: automationComplete - Tab already on search page or no active tab.');
                    }
                });

                // Final message after all downloads are initiated
                resultDiv.innerHTML = `Automation complete! All download prompts initiated. Please check your downloads.<br>You can now click anywhere on the tab to close this popup.`;
                resultDiv.classList.add('success');
            } else {
                console.log('popup.js: automationComplete - No transcripts collected for download.');
                resultDiv.innerHTML = `Automation complete! No transcripts were collected for download.<br>You can now click anywhere on the tab to close this popup.`;
                resultDiv.classList.add('success');
            }
        } else if (request.action === "titleNotFoundInList") {
            console.warn('popup.js: titleNotFoundInList - Warning:', request.title, request.reason);
            resultDiv.textContent = `Warning: Title "${request.title}" not found in conversation list. Reason: ${request.reason || 'Unknown'}. Proceeding to next.`;
            resultDiv.classList.add('failure');
        } else if (request.action === "searchAborted") {
            resultDiv.textContent = 'Search aborted by user. Conversation list search was aborted. Please try again or adjust your search.';
            resultDiv.classList.add('info');
            setAbortButtonVisible(false);
            startAutomationBtn.classList.add('hidden');
        }
    });

    // Remove duplicate debug panel creation at the end
});
