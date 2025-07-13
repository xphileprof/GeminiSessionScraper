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
    const closePopupBtn = document.getElementById('closePopupBtn');
    const savePrefixInput = document.getElementById('savePrefix');
    const pauseDurationInput = document.getElementById('pauseDuration'); // Added to fix ReferenceError

    let cachedTitlesFromSearchResults = []; // To store titles retrieved from search results for automation
    // Removed currentExtractionIndex - now using batch automation instead

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

    // Utility to show/hide close button
    function setCloseButtonVisible(visible) {
        if (visible) {
            closePopupBtn.classList.remove('hidden');
        } else {
            closePopupBtn.classList.add('hidden');
        }
    }

    // Close button event listener
    closePopupBtn.addEventListener('click', () => {
        console.log('popup.js: Close button clicked - closing popup window');
        window.close();
    });

    // Function to initialize the popup state, including setting the default prefix
    async function initializePopup() {
        console.log('popup.js: initializePopup - Starting initialization.');
        resultDiv.textContent = 'Verifying current tab...';
        resultDiv.className = 'result-box info';
        startAutomationBtn.classList.add('hidden'); // Ensure hidden initially
        setAbortButtonVisible(false); // Hide and reset abort button
        setCloseButtonVisible(false); // Hide close button initially

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

    // Event listener for the "Extract All Transcripts" button (uses batch automation)
    startAutomationBtn.addEventListener('click', async () => {
        console.log('popup.js: Extract All Transcripts button clicked. Total titles:', cachedTitlesFromSearchResults.length);
        
        if (cachedTitlesFromSearchResults.length === 0) {
            console.log('popup.js: No transcripts to extract');
            resultDiv.textContent = 'No transcripts found to extract!';
            resultDiv.classList.add('failure');
            return;
        }
        
        let savePrefix = savePrefixInput.value.trim();
        // Ensure the prefix ends with a slash if it's not empty
        if (savePrefix && !savePrefix.endsWith('/')) {
            savePrefix += '/';
        }
        // Basic validation for the save prefix
        if (!savePrefix) {
            resultDiv.textContent = 'Please enter a Transcript File Prefix before starting extraction.';
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

        startAutomationBtn.disabled = true; // Disable this button while processing
        startAutomationBtn.textContent = 'Processing All Transcripts...';
        setAbortButtonVisible(false); // Hide abort button during extraction

        resultDiv.textContent = `Starting batch extraction of all ${cachedTitlesFromSearchResults.length} transcripts...`;
        resultDiv.classList.add('info');

        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            console.log('popup.js: Sending "startAutomation" message to content.js for batch processing');
            console.log('popup.js: Save prefix:', savePrefix);
            console.log('popup.js: Pause duration:', pauseDuration);
            console.log('popup.js: Total transcripts:', cachedTitlesFromSearchResults.length);
            
            // Send a message to content.js to start batch automation
            chrome.tabs.sendMessage(tab.id, {
                action: "startAutomation",
                savePrefix: savePrefix,
                pauseDuration: pauseDuration * 1000, // Convert seconds to milliseconds
                scrollAttempts: 50 // Default scroll attempts
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
                    cachedTitlesFromSearchResults = request.titles; // Store titles for one-by-one extraction
                    // No need to reset extraction index - using batch automation
                    
                    if (request.titles.length > 0) {
                        startAutomationBtn.classList.remove('hidden');
                        startAutomationBtn.disabled = false;
                        
                        // Update button text for batch extraction
                        if (request.titles.length === 1) {
                            startAutomationBtn.textContent = 'Extract 1 Transcript';
                        } else {
                            startAutomationBtn.textContent = `Extract All ${request.titles.length} Transcripts`;
                        }
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
            resultDiv.textContent = `Extracting & Downloading: "${request.title}" (${request.current} of ${request.total})...`;
            resultDiv.classList.add('info');
            startAutomationBtn.classList.add('hidden');
            setAbortButtonVisible(false);
            // Ensure hidden during processing
            // Remove: searchStatusDiv.classList.add('hidden');
        } else if (request.action === "automationComplete") {
            console.log('popup.js: ====== AUTOMATION COMPLETE MESSAGE RECEIVED ======');
            console.log('popup.js: Timestamp:', new Date().toISOString());
            console.log('popup.js: Message:', request.message);
            console.log('popup.js: Number of transcripts received:', request.transcripts?.length || 0);
            console.log('popup.js: Transcript metadata preview:', request.transcripts?.map(t => ({ 
                title: t.title, 
                timestamp: t.timestamp,
                hasContent: !!t.content,
                contentLength: t.content?.length || 0
            })) || []);
            
            resultDiv.textContent = request.message || 'Automation complete!';
            resultDiv.classList.add('success');
            startAutomationBtn.classList.add('hidden');
            setAbortButtonVisible(false); // Only use the robust utility

            if (request.transcripts && request.transcripts.length > 0) {
                console.log('popup.js: automationComplete - Creating download links for', request.transcripts.length, 'transcripts.');
                
                const currentSavePrefix = savePrefixInput.value.trim();
                
                // Create a download section in the popup
                resultDiv.innerHTML = `
                    <div class="success">🎉 Automation complete! ${request.transcripts.length} transcripts extracted and downloaded.</div>
                    <div class="download-section">
                        <h3>📥 Downloads Status:</h3>
                        <div class="info" style="margin: 10px 0; padding: 10px; background: #e8f5e9; border: 1px solid #4caf50; border-radius: 4px;">
                            ✅ Files were downloaded automatically during extraction<br>
                            📁 Check your Downloads folder for ${request.transcripts.length} files
                        </div>
                        <button id="verifyDownloadsBtn" class="download-all-btn">🔍 Verify Downloads</button>
                        <div id="downloadStatus" class="download-links"></div>
                    </div>
                `;
                
                // Show close button after completion
                setCloseButtonVisible(true);
                
                const verifyDownloadsBtn = document.getElementById('verifyDownloadsBtn');
                const downloadStatusDiv = document.getElementById('downloadStatus');
                
                // Verify downloads when button is clicked
                verifyDownloadsBtn.addEventListener('click', async () => {
                    console.log('popup.js: ====== VERIFY DOWNLOADS BUTTON CLICKED ======');
                    console.log('popup.js: Timestamp:', new Date().toISOString());
                    console.log('popup.js: Checking download status with content.js');
                    
                    verifyDownloadsBtn.textContent = '� Checking...';
                    verifyDownloadsBtn.disabled = true;
                    
                    // Get current tab to send message to content.js
                    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (!tab) {
                        console.error('popup.js: Could not get current tab for verification');
                        verifyDownloadsBtn.textContent = '❌ Error: No Tab';
                        return;
                    }
                    
                    // Send verification message
                    const verificationMessage = {
                        action: "downloadAllTranscripts",
                        savePrefix: currentSavePrefix
                    };
                    
                    try {
                        const response = await chrome.tabs.sendMessage(tab.id, verificationMessage);
                        console.log('popup.js: Verification response:', response);
                        
                        if (response?.success && response?.alreadyDownloaded) {
                            verifyDownloadsBtn.textContent = '✅ All Downloads Verified!';
                            verifyDownloadsBtn.style.backgroundColor = '#059669';
                            downloadStatusDiv.innerHTML = `
                                <div style="margin-top: 10px; padding: 10px; background: #e8f5e9; border: 1px solid #4caf50; border-radius: 4px;">
                                    <strong>✅ Download Verification Complete</strong><br>
                                    📊 ${response.downloadCount}/${response.totalTranscripts} files downloaded successfully<br>
                                    📁 Files saved with prefix: <code>${currentSavePrefix}</code><br>
                                    💡 Files should be in your Downloads folder
                                </div>
                            `;
                        } else {
                            verifyDownloadsBtn.textContent = '⚠️ Verification Issues';
                            verifyDownloadsBtn.style.backgroundColor = '#f59e0b';
                            downloadStatusDiv.innerHTML = `
                                <div style="margin-top: 10px; padding: 10px; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 4px;">
                                    <strong>⚠️ Download Verification Results</strong><br>
                                    📊 ${response?.downloadCount || 0}/${response?.totalTranscripts || 0} files verified<br>
                                    ❌ Error: ${response?.error || 'Unknown verification error'}
                                </div>
                            `;
                        }
                    } catch (error) {
                        console.error('popup.js: Error during verification:', error);
                        verifyDownloadsBtn.textContent = '❌ Verification Failed';
                        verifyDownloadsBtn.style.backgroundColor = '#dc2626';
                    }
                });
                
            } else {
                console.log('popup.js: automationComplete - No transcripts collected for download.');
                resultDiv.innerHTML = `
                    <div class="success">✅ Automation complete!</div>
                    <div class="info">ℹ️ No transcripts were collected for download.</div>
                    <div class="info" style="margin-top: 10px; font-size: 0.9rem;">
                        This might happen if no conversations matched your search or if the conversations had no extractable content.
                    </div>
                `;
                // Show close button even when no transcripts
                setCloseButtonVisible(true);
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
            setCloseButtonVisible(true); // Show close button if aborted
        }
    });

    // Remove duplicate debug panel creation at the end
});
