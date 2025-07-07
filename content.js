// content.js
console.log('content.js: Script loaded and starting execution.'); // This should be the very first log

// Variables to manage the automation state
let titlesToProcess = [];
let currentIndex = 0;
let collectedTranscripts = []; // Array to store all extracted transcripts
let globalSavePrefix = ''; // To store the prefix provided by the user
let pauseDurationMs = 500; // Default pause duration in milliseconds (0.5 seconds)

/**
 * Extracts the text content of prompt-response pairs from the current conversation page.
 * @returns {string} The formatted transcript.
 */
function extractTranscript() {
    console.log('content.js: extractTranscript - Starting transcript extraction.');
    let transcript = '';
    // Select all conversation message containers
    const conversationMessages = document.querySelectorAll('.conversation-container');

    if (conversationMessages.length === 0) {
        console.warn('content.js: extractTranscript - No conversation messages found on page.');
    }

    conversationMessages.forEach((messageContainer, index) => {
        // Try to find the user query (prompt) within this container
        const userQueryElement = messageContainer.querySelector('.user-query-bubble-with-background .query-text p');
        if (userQueryElement) {
            transcript += `--- PROMPT ${index + 1} ---\n`;
            transcript += userQueryElement.innerText.trim() + '\n\n';
            console.log(`content.js: extractTranscript - Extracted Prompt ${index + 1}.`);
        } else {
            console.warn(`content.js: extractTranscript - No user query found for message container ${index + 1}.`);
        }

        // Try to find the model response within this container
        // Modified selector to target the main content area of the response
        const modelResponseElement = messageContainer.querySelector('.model-response-text');
        if (modelResponseElement) {
            transcript += `--- RESPONSE ${index + 1} ---\n`;
            // Get all text content from within the model-response-text element
            transcript += modelResponseElement.innerText.trim() + '\n\n';
            console.log(`content.js: extractTranscript - Extracted Response ${index + 1}.`);
        } else {
            console.warn(`content.js: extractTranscript - No model response found for message container ${index + 1} using '.model-response-text' selector.`);
        }
    });
    console.log('content.js: extractTranscript - Finished transcript extraction. Transcript length:', transcript.length);
    return transcript;
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
        // Trim whitespace and remove non-breaking space character (U+00A0)
        // which can sometimes appear at the end of the text.
        if (element.innerText.trim().replace(/\u00A0/g, '') === targetTitle) {
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
            await new Promise(resolve => setTimeout(resolve, pauseDurationMs));
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
            await new Promise(resolve => setTimeout(resolve, pauseDurationMs));
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
        const regex = /(\d+)\sresults for\s["“]([^"”\s]+)["”]/;
        const match = pageText.match(regex);

        const titlesFromSearchResults = [];
        const conversationTitlesFromList = [];
        let allTitlesMatchedInConversationList = false;
        let searchString = '';

        if (match) {
            searchString = match[2];
            console.log('content.js: searchPageContent - Search pattern matched. Search string:', searchString);

            const searchResultTitleElements = document.querySelectorAll('.gds-title-m.title');
            searchResultTitleElements.forEach(element => {
                titlesFromSearchResults.push(element.innerText.trim());
            });
            console.log('content.js: searchPageContent - Titles from search results:', titlesFromSearchResults);


            const conversationTitleElements = document.querySelectorAll('.conversation-title');
            conversationTitleElements.forEach(element => {
                conversationTitlesFromList.push(element.innerText.trim().replace(/\u00A0/g, ''));
            });
            console.log('content.js: searchPageContent - Titles from conversation list:', conversationTitlesFromList);


            if (titlesFromSearchResults.length > 0) {
                allTitlesMatchedInConversationList = titlesFromSearchResults.every(searchTitle => {
                    return conversationTitlesFromList.includes(searchTitle);
                });
                console.log('content.js: searchPageContent - All titles matched in conversation list:', allTitlesMatchedInConversationList);
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
                titles: titlesFromSearchResults,
                conversationTitles: conversationTitlesFromList,
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
    }
});
