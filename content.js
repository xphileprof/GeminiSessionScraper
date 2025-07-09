// content.js
// Script loaded and starting execution.
console.log('content.js: Script loaded and starting execution.');

// Use a global flag to prevent re-initialization if the script is injected multiple times
// This is crucial for preventing "Identifier has already been declared" errors
if (typeof window.geminiTranscriptExtractorContentScriptInitialized === 'undefined') {
    window.geminiTranscriptExtractorContentScriptInitialized = true;
    console.log('content.js: Initializing content script for the first time.');

    // Variables to manage the automation state
    let titlesToProcess = [];
    let currentIndex = 0;
    let collectedTranscripts = []; // Array to store all extracted transcripts
    let globalSavePrefix = ''; // To store the prefix provided by the user
    let pauseDurationMs = 500; // Default pause duration in milliseconds (0.5 seconds)
    let isSearchAborted = false; // Flag to control search abortion

    // New variable for artificial delay between scroll attempts for observation
    const scrollObservationDelayMs = 0; // Reduced to 0ms for minimal delay

    /**
     * Extracts the text content of prompt-response pairs from the current conversation page.
     * @returns {string} The formatted transcript.
     */
    function extractTranscript() {
        console.log('content.js: extractTranscript - Starting transcript extraction.');
        let transcript = '';
        // Select all user-query elements (prompts)
        const promptElements = document.querySelectorAll('user-query');
        // Select all model-response elements (responses)
        const responseElements = document.querySelectorAll('model-response');

        const maxPairs = Math.max(promptElements.length, responseElements.length);
        if (maxPairs === 0) {
            console.warn('content.js: extractTranscript - No user-query or model-response elements found on page.');
        }

        for (let i = 0; i < maxPairs; i++) {
            // PROMPT
            let promptText = '[Prompt not found]';
            if (promptElements[i]) {
                // Try to get all text from the prompt element, fallback to previous selector
                let found = false;
                // Try the p tag
                const p = promptElements[i].querySelector('.user-query-bubble-with-background .query-text p');
                if (p && p.innerText.trim()) {
                    promptText = p.innerText.trim();
                    found = true;
                }
                // Fallback: get all visible text
                if (!found) {
                    const allText = promptElements[i].innerText.trim();
                    if (allText) promptText = allText;
                }
            }
            transcript += `--- PROMPT ${i + 1} ---\n` + promptText + '\n\n';

            // RESPONSE
            let responseText = '[Response not found]';
            if (responseElements[i]) {
                // Try to get all text from the message-content element, fallback to previous selector
                let found = false;
                const messageContent = responseElements[i].querySelector('message-content');
                if (messageContent && messageContent.innerText.trim()) {
                    responseText = messageContent.innerText.trim();
                    found = true;
                }
                // Fallback: get all visible text
                if (!found) {
                    const allText = responseElements[i].innerText.trim();
                    if (allText) responseText = allText;
                }
            }
            transcript += `--- RESPONSE ${i + 1} ---\n` + responseText + '\n\n';
        }
        console.log('content.js: extractTranscript - Finished transcript extraction. Transcript length:', transcript.length);
        return transcript;
    }

    /**
     * Scrolls the conversation list sidebar to load all conversations.
     * This function now attempts to simulate user-like scrolling for virtualized lists.
     * @param {Array<string>} requiredTitles - The titles we expect to find.
     * @returns {Promise<Array<string>>} A promise that resolves with all loaded conversation titles.
     */
    async function scrollConversationList(requiredTitles) {
        console.log('content.js: scrollConversationList - Starting auto-scrolling (Virtualized Strategy).');
        console.log('content.js: scrollConversationList - Required titles to find:', requiredTitles);

        // Reset abort flag at the start of a new search
        isSearchAborted = false;

        let scrollableElement = document.querySelector('[data-test-id="overflow-container"]');
        if (!scrollableElement) {
            scrollableElement = document.querySelector('.chat-history');
        }
        if (!scrollableElement) {
            scrollableElement = document.documentElement;
        }
        if (!scrollableElement) {
            console.error('content.js: scrollConversationList - No suitable scrollable element found for dispatching wheel events. Cannot auto-scroll reliably.');
            return [];
        }

        // Cumulative set of all unique titles seen during scrolling
        const allTitlesSeen = new Set();

        let previousItemCount = -1;
        let loadedConversationTitles = [];
        let allRequiredFound = false;
        const maxScrollAttempts = 15000;
        let scrollAttempt = 0;
        let noNewItemsCount = 0;
        const scrollIncrement = 50;
        const scrollDelay = 100;
        const smallScrollIncrement = 100;

        // Only scroll down to load older conversations
        const largeScrollIncrement = 500;
        let lastVisibleTitle = null;
        let lastVisibleUnchangedCount = 0;
        while (!allRequiredFound && scrollAttempt < maxScrollAttempts && !isSearchAborted) {
            scrollAttempt++;
            if (scrollAttempt % 50 === 0) {
                console.log(`content.js: scrollConversationList - Progress: Attempt ${scrollAttempt}, Titles seen so far: ${allTitlesSeen.size}, Last batch:`, loadedConversationTitles);
                console.log(`content.js: scrollConversationList - Unfound required titles so far:`, requiredTitles.filter(t => !allTitlesSeen.has(t)));
            }

            console.log(`content.js: scrollConversationList - Scroll attempt ${scrollAttempt}. Direction: down`);

            const currentScrollTop = scrollableElement.scrollTop;
            const currentScrollHeight = scrollableElement.scrollHeight;
            const currentClientHeight = scrollableElement.clientHeight;

            console.log(`content.js: scrollConversationList - BEFORE scroll: scrollTop=${currentScrollTop}, scrollHeight=${currentScrollHeight}, clientHeight=${currentClientHeight}`);

            // Scroll down by a small increment
            scrollableElement.scrollTop = Math.min(scrollableElement.scrollTop + smallScrollIncrement, scrollableElement.scrollHeight);
            // Dispatch a synthetic wheel event with a small increment (down)
            const wheelEvent = new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                view: window,
                detail: 0,
                deltaY: smallScrollIncrement,
                deltaMode: WheelEvent.DOM_DELTA_PIXEL
            });
            scrollableElement.dispatchEvent(wheelEvent);
            console.log('content.js: scrollConversationList - Dispatched synthetic wheel event.');

            // Try to scroll the last visible conversation title into view
            const visibleTitles = Array.from(document.querySelectorAll('.conversation-title'));
            if (visibleTitles.length > 0) {
                visibleTitles[visibleTitles.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
                console.log(`content.js: scrollConversationList - Called scrollIntoView on last visible title: '${visibleTitles[visibleTitles.length - 1].innerText.trim().replace(/\u00A0/g, '')}'`);
            }

            // Wait for new content to potentially load after the scroll/wheel event
            await new Promise(resolve => setTimeout(resolve, scrollDelay));

            // Log number of conversation elements after scroll
            const numTitles = document.querySelectorAll('.conversation-title').length;
            const numConvos = document.querySelectorAll('[data-test-id="conversation"]').length;
            console.log(`content.js: scrollConversationList - .conversation-title count: ${numTitles}, [data-test-id="conversation"] count: ${numConvos}`);

            // Log first and last visible conversation titles
            const visibleTitlesText = visibleTitles.map(e => e.innerText.trim().replace(/\u00A0/g, ''));
            if (visibleTitlesText.length > 0) {
                console.log(`content.js: scrollConversationList - First visible: '${visibleTitlesText[0]}', Last visible: '${visibleTitlesText[visibleTitlesText.length - 1]}'`);
            }

            // Re-scan titles and count items
            loadedConversationTitles = [];
            const currentConversationElements = document.querySelectorAll('.conversation-title');
            currentConversationElements.forEach(element => {
                const cleanedTitle = element.innerText.trim().replace(/\u00A0/g, '');
                loadedConversationTitles.push(cleanedTitle);
                allTitlesSeen.add(cleanedTitle); // <-- Add to cumulative set
            });
            if (scrollAttempt % 50 === 0) {
                console.log(`content.js: scrollConversationList - After scan: Titles seen: ${allTitlesSeen.size}, Loaded this batch:`, loadedConversationTitles);
            }
            const currentItemCount = document.querySelectorAll('[data-test-id="conversation"]').length;
            chrome.runtime.sendMessage({
                action: "searchProgress",
                loadedTitlesCount: loadedConversationTitles.length
            });
            if (scrollAttempt % 10 === 0) {
                console.log(`content.js: scrollConversationList - About to send searchProgress: loadedTitlesCount=${loadedConversationTitles.length}, loadedConversationTitles:`, loadedConversationTitles);
            }
            chrome.runtime.sendMessage({
                action: "searchProgress",
                loadedTitlesCount: loadedConversationTitles.length
            });
            await new Promise(resolve => setTimeout(resolve, scrollObservationDelayMs));

            // Check if all required titles are now present in the cumulative set
            allRequiredFound = requiredTitles.every(reqTitle => allTitlesSeen.has(reqTitle));
            if (allRequiredFound) {
                console.log('content.js: scrollConversationList - All required titles found!');
                break;
            }

            // Check if the last visible title is stuck
            let currentLastVisible = visibleTitlesText.length > 0 ? visibleTitlesText[visibleTitlesText.length - 1] : null;
            if (currentLastVisible === lastVisibleTitle) {
                lastVisibleUnchangedCount++;
            } else {
                lastVisibleUnchangedCount = 0;
                lastVisibleTitle = currentLastVisible;
            }
            if (lastVisibleUnchangedCount >= 100) {
                console.warn('content.js: scrollConversationList - Last visible title has not changed for 100 scrolls. Assuming end of list or virtualization limit.');
                break;
            }

            if (currentItemCount === previousItemCount) {
                noNewItemsCount++;
                if (noNewItemsCount >= 200) {
                    console.log('content.js: scrollConversationList - No new items for 200 consecutive attempts. Assuming end of scrollable content or virtualization limit.');
                    // Log the outerHTML of the scrollable container for debugging
                    console.log('content.js: scrollConversationList - scrollableElement.outerHTML (truncated):', scrollableElement.outerHTML.substring(0, 1000));
                    // Warn the user if the list appears stuck
                    console.warn('content.js: scrollConversationList - The conversation list may be limited by Gemini UI virtualization. Some older conversations may not be accessible.');
                    break;
                }
            } else {
                noNewItemsCount = 0;
            }
            previousItemCount = currentItemCount;
        }

        if (isSearchAborted) {
            console.warn('content.js: scrollConversationList - Search aborted by user.');
            chrome.runtime.sendMessage({ action: "searchAborted" });
            return [];
        } else if (!allRequiredFound) {
            const unfoundTitles = requiredTitles.filter(reqTitle => !allTitlesSeen.has(reqTitle));
            console.warn('content.js: scrollConversationList - Not all required titles found after max scroll attempts or end of list. Unfound titles:', unfoundTitles);
        }
        return Array.from(allTitlesSeen); // Return all unique titles seen
    }


    /**
     * Processes the next conversation title in the list.
     * It finds the corresponding element, clicks it, extracts transcript, and then navigates back.
     * This function is now fully automated and does not wait for user input between steps.
     */
    async function processNextConversation() {
        console.log(`content.js: processNextConversation - Called for index ${currentIndex} of ${titlesToProcess.length}.`);

        // Check if all titles have been processed
        if (currentIndex >= titlesToProcess.length) {
            console.log('content.js: processNextConversation - All titles processed. Sending automationComplete message.');
            // Send all collected transcripts to popup.js
            chrome.runtime.sendMessage({
                action: "automationComplete",
                message: "All search result conversations processed. Transcripts ready for download.",
                transcripts: collectedTranscripts // Send the array of collected transcripts
            });
            console.log('content.js: processNextConversation - "automationComplete" message sent.');
            return; // Exit the function
        }

        const targetTitle = titlesToProcess[currentIndex];
        console.log('content.js: processNextConversation - Target title for current index:', targetTitle);

        // Select all elements that represent conversation titles in the sidebar
        const conversationElements = document.querySelectorAll('.conversation-title');
        let foundElement = null;

        // Iterate through conversation titles to find the one matching our target
        for (const element of conversationElements) {
            // Ensure consistent cleaning for comparison
            const cleanedElementText = element.innerText.trim().replace(/\u00A0/g, '');
            if (cleanedElementText === targetTitle) {
                foundElement = element;
                console.log('content.js: processNextConversation - Found clickable element for title:', targetTitle);
                break; // Found the element, exit loop
            }
        }

        if (foundElement) {
            // Inform popup.js that we are processing this title
            chrome.runtime.sendMessage({ action: "processingTitle", title: targetTitle, current: currentIndex + 1, total: titlesToProcess.length });
            console.log('content.js: processNextConversation - Sent "processingTitle" message.');

            // Find the closest clickable parent element (the conversation item itself)
            const clickableParent = foundElement.closest('[data-test-id="conversation"]');
            if (clickableParent) {
                console.log('content.js: processNextConversation - Clicking conversation item.');
                // Simulate a click on the conversation item
                clickableParent.click();

                // Wait for the page to load after clicking. This is crucial for transcript extraction.
                console.log(`content.js: processNextConversation - Waiting for ${pauseDurationMs}ms after click.`);
                await new Promise(resolve => setTimeout(resolve, 100)); // Reduced to 100ms
                console.log('content.js: processNextConversation - Finished wait after click.');

                // --- Transcript Extraction Step ---
                const transcriptContent = extractTranscript();
                collectedTranscripts.push({
                    title: targetTitle,
                    content: transcriptContent
                });
                console.log('content.js: processNextConversation - Transcript extracted and stored. Collected so far:', collectedTranscripts.length);


                // Navigate back to the search results page
                console.log('content.js: processNextConversation - Navigating back.');
                window.history.back();
                // Wait for the page to load after navigating back.
                console.log(`content.js: processNextConversation - Waiting for ${pauseDurationMs}ms after back navigation.`);
                await new Promise(resolve => setTimeout(resolve, 100)); // Reduced to 100ms
                console.log('content.js: processNextConversation - Finished wait after back navigation.');

                currentIndex++; // Move to the next title
                console.log('content.js: processNextConversation - Incrementing index to', currentIndex);
                processNextConversation(); // Continue with the next title immediately

            } else {
                console.warn('content.js: processNextConversation - Clickable parent not found for title:', targetTitle);
                // If the clickable parent was not found, report an error and move to the next title
                chrome.runtime.sendMessage({ action: "titleNotFoundInList", title: targetTitle, reason: "Clickable parent element not found for this title." });
                currentIndex++; // Move to the next title
                processNextConversation(); // Immediately try to process the next one
            }
        } else {
            console.warn('content.js: processNextConversation - Title not found in conversation list:', targetTitle);
            // If the target title text was not found in the conversation list, report and move on
            chrome.runtime.sendMessage({ action: "titleNotFoundInList", title: targetTitle, reason: "Title text not found in the conversation list." });
            currentIndex++; // Move to the next title
            processNextConversation(); // Immediately try to process the next one
        }
    }

    // Listener for messages from popup.js
    chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
        console.log('content.js: Received message from popup.js:', request.action, request);

        if (request.action === "searchPageContent") {
            const pageText = document.body.innerText;
            console.log('content.js: searchPageContent - Full pageText for regex analysis (first 500 chars):', pageText.substring(0, 500));

            // Regex to find "<n> results for "<s>"" or "<n> results for <s>" etc.
            // It captures the number, the literal "results for", and then the search string.
            // The search string can be quoted or unquoted, and can contain spaces.
            const regex = /(\d+)\sresults for\s(?:["“])?(.+?)(?:["”])?(?:$|\s)/;
            const match = pageText.match(regex);

            const titlesFromSearchResults = [];
            let conversationTitlesFromList = []; // Will be populated after scrolling
            let allTitlesMatchedInConversationList = false;
            let searchString = '';

            if (match) {
                searchString = match[2].trim(); // Trim any leading/trailing whitespace from the captured string
                console.log('content.js: searchPageContent - Search pattern matched. Raw match[0]:', match[0]);
                console.log('content.js: searchPageContent - Captured searchString (match[2]):', match[2]);
                console.log('content.js: searchPageContent - Trimmed searchString:', searchString);


                const searchResultTitleElements = document.querySelectorAll('.gds-title-m.title');
                searchResultTitleElements.forEach(element => {
                    const cleanedTitle = element.innerText.trim().replace(/\u00A0/g, ''); // Clean before storing
                    titlesFromSearchResults.push(cleanedTitle);
                });
                console.log('content.js: searchPageContent - Cleaned Titles from search results:', titlesFromSearchResults);

                // --- NEW: Auto-scroll and re-scan conversation list ---
                conversationTitlesFromList = await scrollConversationList(titlesFromSearchResults);
                console.log('content.js: searchPageContent - Final Cleaned Titles from conversation list after scrolling:', conversationTitlesFromList.length, conversationTitlesFromList);


                if (titlesFromSearchResults.length > 0) {
                    allTitlesMatchedInConversationList = titlesFromSearchResults.every(searchTitle => {
                        // Compare already cleaned titles
                        return conversationTitlesFromList.includes(searchTitle);
                    });
                    console.log('content.js: searchPageContent - All titles matched in conversation list after scrolling:', allTitlesMatchedInConversationList);
                } else {
                    allTitlesMatchedInConversationList = false;
                    console.log('content.js: searchPageContent - No search result titles to match.');
                }

                titlesToProcess = titlesFromSearchResults;
                collectedTranscripts = [];
                currentIndex = 0;

                chrome.runtime.sendMessage({
                    action: "searchResults",
                    found: true,
                    match: match[0],
                    numResults: parseInt(match[1], 10),
                    searchString: searchString,
                    titles: titlesFromSearchResults, // Send cleaned titles
                    conversationTitles: conversationTitlesFromList, // Send cleaned titles
                    allTitlesMatched: allTitlesMatchedInConversationList
                });
                console.log('content.js: searchPageContent - Sent "searchResults" message (found).');

            } else {
                console.log('content.js: searchPageContent - Search pattern NOT matched.');
                chrome.runtime.sendMessage({
                    action: "searchResults",
                    found: false,
                    searchString: ''
                });
                console.log('content.js: searchPageContent - Sent "searchResults" message (not found).');
            }
        } else if (request.action === "startAutomation") {
            console.log('content.js: Received "startAutomation" message.');
            globalSavePrefix = request.savePrefix || '';
            pauseDurationMs = request.pauseDuration || 500;
            console.log('content.js: startAutomation - Global save prefix:', globalSavePrefix, 'Pause duration (ms):', pauseDurationMs);

            if (titlesToProcess.length > 0) {
                console.log('content.js: startAutomation - Initiating processNextConversation.');
                processNextConversation();
            } else {
                console.log('content.js: startAutomation - No titles to process. Sending "automationComplete".');
                chrome.runtime.sendMessage({ action: "automationComplete", message: "No search result titles were found to process for automation." });
            }
        } else if (request.action === "abortSearch") { // New listener for abort message
            console.log('content.js: Received "abortSearch" message. Setting isSearchAborted to true.');
            isSearchAborted = true; // Set the flag to true to stop the scrolling loop
        }
    });
} else { // This block handles subsequent injections of the content script
    console.log('content.js: Content script already initialized. Re-using existing instance.');

    // On subsequent injections, we still need to handle incoming messages
    chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
        console.log('content.js: Received message from popup.js (already initialized instance):', request.action, request);

        // Re-evaluate searchPageContent if the popup requests it again
        if (request.action === "searchPageContent") {
            console.log('content.js: Re-running searchPageContent logic on an already initialized script.');
            // Reset abort flag for new search
            isSearchAborted = false;

            const pageText = document.body.innerText;
            const regex = /(\d+)\sresults for\s(?:["“])?(.+?)(?:["”])?(?:$|\s)/;
            const match = pageText.match(regex);

            const titlesFromSearchResults = [];
            let searchString = '';

            if (match) {
                searchString = match[2].trim();
                const searchResultTitleElements = document.querySelectorAll('.gds-title-m.title');
                searchResultTitleElements.forEach(element => {
                    const cleanedTitle = element.innerText.trim().replace(/\u00A0/g, '');
                    titlesFromSearchResults.push(cleanedTitle);
                });
            }

            // Re-run the scrolling process to get the full list of conversations
            const conversationTitlesFromList = await scrollConversationList(titlesFromSearchResults);

            let allTitlesMatched = titlesFromSearchResults.every(searchTitle =>
                conversationTitlesFromList.includes(searchTitle)
            );

            // --- FIX: Update automation state variables here ---
            titlesToProcess = titlesFromSearchResults;
            collectedTranscripts = [];
            currentIndex = 0;
            // ---------------------------------------------------

            // Send the searchResults message back to the popup
            chrome.runtime.sendMessage({
                action: "searchResults",
                found: !!match, // True if regex matched
                searchString: searchString,
                titles: titlesFromSearchResults,
                conversationTitles: conversationTitlesFromList,
                allTitlesMatched: allTitlesMatched
            });
            console.log('content.js: searchPageContent - Sent "searchResults" message (re-run).');

        } else if (request.action === "startAutomation") {
            console.log('content.js: Received "startAutomation" message (already initialized).');
            globalSavePrefix = request.savePrefix || '';
            pauseDurationMs = request.pauseDuration || 500;
            processNextConversation();
        } else if (request.action === "abortSearch") {
            console.log('content.js: Received "abortSearch" message (already initialized). Setting isSearchAborted to true.');
            isSearchAborted = true;
        }
    });
}

// Listen for logToPageConsole messages from popup.js and log to the main page's console
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'logToPageConsole' && request.message) {
        console.log('[Gemini Extension]', request.message);
    }
});
