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
    /**
     * Checks if a response element contains placeholder/loading text instead of actual content
     */
    function isPlaceholderResponse(text) {
        if (!text || typeof text !== 'string') return true;
        
        const placeholderIndicators = [
            'show thinking',
            'loading...',
            'thinking...',
            'generating response...',
            'please wait...',
            'loading',
            'generating',
            'processing',
            'working on it',
            'one moment',
            'you stopped this response',
            '...',
            'wait'
        ];
        
        const cleanText = text.trim().toLowerCase();
        
        // Check if the text is just "Show thinking" or starts with it and has minimal additional content
        if (cleanText.startsWith('show thinking')) {
            // If it's just "Show thinking" or "Show thinking" with very little additional text, consider it a placeholder
            const remainingText = cleanText.replace(/^show thinking\s*/, '').trim();
            if (remainingText.length < 50) { // Less than 50 characters after "Show thinking"
                return true;
            }
        }
        
        // Special case for stopped responses
        if (cleanText.includes('you stopped this response')) {
            return true;
        }
        
        return placeholderIndicators.some(indicator => 
            cleanText === indicator.toLowerCase() || 
            cleanText.startsWith(indicator.toLowerCase())
        ) || cleanText.length < 10; // Very short responses are likely placeholders
    }

    /**
     * Extracts the actual response content, skipping over "Show thinking" sections
     */
    function extractActualResponse(responseElement) {
        if (!responseElement) return '';
        
        console.log('content.js: extractActualResponse - Processing response element');
        
        // Based on the DOM structure: <model-response> contains <model-thoughts> (with "Show thinking") 
        // and <message-content> (with actual response)
        
        // Strategy 1: Look for message-content element which should contain the actual response
        const messageContent = responseElement.querySelector('message-content');
        if (messageContent) {
            let responseText = messageContent.innerText.trim();
            console.log(`content.js: extractActualResponse - Found message-content with text: "${responseText.substring(0, 100)}..."`);
            
            // The message-content should contain the actual response, not "Show thinking"
            // If it contains "Show thinking", it means the structure is different than expected
            if (responseText.toLowerCase().includes('show thinking')) {
                console.log('content.js: extractActualResponse - message-content contains "Show thinking", trying to extract actual content...');
                
                // Look for content that comes after "Show thinking" text
                const lines = responseText.split('\n');
                let actualLines = [];
                let foundActualContent = false;
                
                for (let line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.toLowerCase().includes('show thinking')) {
                        foundActualContent = true;
                        continue;
                    }
                    if (foundActualContent && trimmedLine.length > 0) {
                        actualLines.push(trimmedLine);
                    }
                }
                
                if (actualLines.length > 0) {
                    responseText = actualLines.join('\n').trim();
                    console.log('content.js: extractActualResponse - Extracted actual response from lines after "Show thinking"');
                } else {
                    // Try to find child elements with actual content
                    const childElements = messageContent.querySelectorAll('p, div, span');
                    for (let element of childElements) {
                        const elementText = element.innerText?.trim();
                        if (elementText && 
                            elementText.length > 20 && 
                            !elementText.toLowerCase().includes('show thinking') &&
                            !isPlaceholderResponse(elementText)) {
                            responseText = elementText;
                            console.log('content.js: extractActualResponse - Found actual response in child element');
                            break;
                        }
                    }
                    
                    if (responseText.toLowerCase().includes('show thinking')) {
                        responseText = '[Response hidden behind "Show thinking" - could not extract actual content]';
                        console.log('content.js: extractActualResponse - Could not extract actual response, returning placeholder');
                    }
                }
            }
            
            return responseText;
        }
        
        // Strategy 2: If no message-content found, check if model-thoughts is present and skip it
        const modelThoughts = responseElement.querySelector('model-thoughts');
        if (modelThoughts) {
            console.log('content.js: extractActualResponse - Found model-thoughts element, looking for content after it...');
            
            // Get all text content but exclude the model-thoughts section
            let allText = responseElement.innerText.trim();
            const thoughtsText = modelThoughts.innerText.trim();
            
            // Remove the thoughts text from the beginning
            if (allText.startsWith(thoughtsText)) {
                allText = allText.substring(thoughtsText.length).trim();
                console.log(`content.js: extractActualResponse - Extracted text after model-thoughts: "${allText.substring(0, 100)}..."`);
            }
            
            if (allText && !isPlaceholderResponse(allText)) {
                return allText;
            }
        }
        
        // Strategy 3: Fallback - get all text and try to extract actual response
        let allText = responseElement.innerText.trim();
        console.log(`content.js: extractActualResponse - Fallback: processing all text: "${allText.substring(0, 100)}..."`);
        
        if (allText.toLowerCase().includes('show thinking')) {
            console.log('content.js: extractActualResponse - Full text contains "Show thinking", attempting to extract actual content...');
            
            // Try to split and find content after "Show thinking"
            const lines = allText.split('\n');
            let actualLines = [];
            let foundActualContent = false;
            
            for (let line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.toLowerCase().includes('show thinking')) {
                    foundActualContent = true;
                    continue;
                }
                if (foundActualContent && trimmedLine.length > 0) {
                    actualLines.push(trimmedLine);
                }
            }
            
            if (actualLines.length > 0) {
                allText = actualLines.join('\n').trim();
                console.log('content.js: extractActualResponse - Extracted actual response from lines after "Show thinking"');
            } else {
                // If we still have "Show thinking", return a placeholder
                allText = '[Response hidden behind "Show thinking" - could not extract actual content]';
                console.log('content.js: extractActualResponse - Could not extract actual response from lines, returning placeholder');
            }
        }
        
        return allText;
    }

    /**
     * Waits for response elements to contain actual content instead of placeholder text
     */
    async function waitForResponseContent(responseElements, maxWaitMs = 5000) {
        console.log('content.js: waitForResponseContent - Waiting for actual response content to load...');
        const startTime = Date.now();
        const checkInterval = 500; // Check every 500ms
        
        while (Date.now() - startTime < maxWaitMs) {
            let hasValidResponses = true;
            
            for (let i = 0; i < responseElements.length; i++) {
                const element = responseElements[i];
                let responseText = '';
                
                // Try different methods to get response text
                const messageContent = element.querySelector('message-content');
                if (messageContent && messageContent.innerText.trim()) {
                    responseText = messageContent.innerText.trim();
                } else {
                    responseText = element.innerText.trim();
                }
                
                if (isPlaceholderResponse(responseText)) {
                    console.log(`content.js: waitForResponseContent - Response ${i + 1} still shows placeholder: "${responseText}"`);
                    hasValidResponses = false;
                    break;
                }
            }
            
            if (hasValidResponses && responseElements.length > 0) {
                console.log('content.js: waitForResponseContent - All responses appear to have valid content');
                return true;
            }
            
            console.log(`content.js: waitForResponseContent - Still waiting for content... (${Date.now() - startTime}ms elapsed)`);
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        
        console.warn('content.js: waitForResponseContent - Timeout waiting for response content');
        return false;
    }

    function extractTranscript() {
        console.log('content.js: extractTranscript - Starting transcript extraction.');
        let transcript = '';
        
        // Debug: Log what elements are actually available
        console.log('content.js: extractTranscript - Checking available elements...');
        console.log('content.js: extractTranscript - user-query elements:', document.querySelectorAll('user-query').length);
        console.log('content.js: extractTranscript - model-response elements:', document.querySelectorAll('model-response').length);
        console.log('content.js: extractTranscript - model-thoughts elements:', document.querySelectorAll('model-thoughts').length);
        console.log('content.js: extractTranscript - message-content elements:', document.querySelectorAll('message-content').length);
        console.log('content.js: extractTranscript - .user-query elements:', document.querySelectorAll('.user-query').length);
        console.log('content.js: extractTranscript - .model-response elements:', document.querySelectorAll('.model-response').length);
        console.log('content.js: extractTranscript - .message-content elements:', document.querySelectorAll('.message-content').length);
        
        // Select all user-query elements (prompts)
        const promptElements = document.querySelectorAll('user-query');
        // Select all model-response elements (responses)
        const responseElements = document.querySelectorAll('model-response');

        const maxPairs = Math.max(promptElements.length, responseElements.length);
        console.log('content.js: extractTranscript - Found prompt elements:', promptElements.length);
        console.log('content.js: extractTranscript - Found response elements:', responseElements.length);
        console.log('content.js: extractTranscript - Max pairs to process:', maxPairs);
        
        if (maxPairs === 0) {
            console.warn('content.js: extractTranscript - No user-query or model-response elements found on page.');
            // Try alternative selectors
            console.log('content.js: extractTranscript - Trying alternative selectors...');
            
            // Try more comprehensive selectors for current Gemini
            const altPrompts = document.querySelectorAll([
                '[data-test-id="user-message"]',
                '.user-message', 
                '[role="user"]',
                '.request-content',
                '.human-message',
                '.user-query',
                '.prompt-content',
                'user-query'
            ].join(', '));
            
            const altResponses = document.querySelectorAll([
                '[data-test-id="assistant-message"]',
                '.assistant-message',
                '[role="assistant"]', 
                '.response-content',
                '.ai-message',
                '.model-response',
                '.gemini-response',
                'model-response'
            ].join(', '));
            
            console.log('content.js: extractTranscript - Alternative prompts found:', altPrompts.length);
            console.log('content.js: extractTranscript - Alternative responses found:', altResponses.length);
            
            // If we found alternative elements, use them
            if (altPrompts.length > 0 || altResponses.length > 0) {
                console.log('content.js: extractTranscript - Using alternative selectors for extraction');
                const maxAltPairs = Math.max(altPrompts.length, altResponses.length);
                
                for (let i = 0; i < maxAltPairs; i++) {
                    // PROMPT
                    let promptText = '[Prompt not found]';
                    if (altPrompts[i]) {
                        const allText = altPrompts[i].innerText.trim();
                        if (allText) {
                            promptText = allText;
                            console.log(`content.js: extractTranscript - Found alt prompt ${i + 1}: "${promptText.substring(0, 100)}..."`);
                        }
                    }
                    transcript += `--- PROMPT ${i + 1} ---\n` + promptText + '\n\n';

                    // RESPONSE
                    let responseText = '[Response not found]';
                    if (altResponses[i]) {
                        // Use extractActualResponse to properly handle "Show thinking" and get only the final response
                        const extractedText = extractActualResponse(altResponses[i]);
                        if (extractedText && !isPlaceholderResponse(extractedText)) {
                            responseText = extractedText;
                            console.log(`content.js: extractTranscript - Found valid alt response ${i + 1}: "${responseText.substring(0, 100)}..."`);
                        } else if (extractedText) {
                            console.log(`content.js: extractTranscript - Skipping placeholder alt response ${i + 1}: "${extractedText}"`);
                            responseText = '[Response still loading - contains placeholder text]';
                        }
                    }
                    transcript += `--- RESPONSE ${i + 1} ---\n` + responseText + '\n\n';
                }
            } else {
                // Log some sample HTML to understand the structure
                const bodyHTML = document.body.innerHTML;
                console.log('content.js: extractTranscript - Body HTML sample (first 1000 chars):', bodyHTML.substring(0, 1000));
                
                // Try to find any div with text content that might be conversation
                const allDivs = document.querySelectorAll('div');
                console.log('content.js: extractTranscript - Total divs found:', allDivs.length);
                
                let textDivs = 0;
                for (let div of allDivs) {
                    if (div.innerText && div.innerText.trim().length > 50) {
                        textDivs++;
                        if (textDivs <= 5) { // Log first 5 text-containing divs
                            console.log(`content.js: extractTranscript - Text div ${textDivs}:`, div.innerText.substring(0, 100));
                        }
                    }
                }
                console.log('content.js: extractTranscript - Divs with substantial text:', textDivs);
            }
        }

        for (let i = 0; i < maxPairs; i++) {
            console.log(`content.js: extractTranscript - Processing pair ${i + 1}/${maxPairs}`);
            
            // PROMPT
            let promptText = '[Prompt not found]';
            if (promptElements[i]) {
                console.log(`content.js: extractTranscript - Processing prompt ${i + 1}, element:`, promptElements[i]);
                console.log(`content.js: extractTranscript - Prompt element HTML:`, promptElements[i].outerHTML.substring(0, 500));
                
                // Try to get all text from the prompt element, fallback to previous selector
                let found = false;
                // Try the p tag
                const p = promptElements[i].querySelector('.user-query-bubble-with-background .query-text p');
                if (p && p.innerText.trim()) {
                    promptText = p.innerText.trim();
                    found = true;
                    console.log(`content.js: extractTranscript - Found prompt via p tag: "${promptText.substring(0, 100)}..."`);
                }
                // Fallback: get all visible text
                if (!found) {
                    const allText = promptElements[i].innerText.trim();
                    if (allText) {
                        promptText = allText;
                        console.log(`content.js: extractTranscript - Found prompt via innerText: "${promptText.substring(0, 100)}..."`);
                    } else {
                        console.log(`content.js: extractTranscript - No text found in prompt element ${i + 1}`);
                    }
                }
            } else {
                console.log(`content.js: extractTranscript - No prompt element at index ${i}`);
            }
            transcript += `--- PROMPT ${i + 1} ---\n` + promptText + '\n\n';

            // RESPONSE
            let responseText = '[Response not found]';
            if (responseElements[i]) {
                console.log(`content.js: extractTranscript - Processing response ${i + 1}, element:`, responseElements[i]);
                console.log(`content.js: extractTranscript - Response element HTML:`, responseElements[i].outerHTML.substring(0, 500));
                
                // Use extractActualResponse to properly handle "Show thinking" and get only the final response
                const extractedText = extractActualResponse(responseElements[i]);
                if (extractedText && !isPlaceholderResponse(extractedText)) {
                    responseText = extractedText;
                    console.log(`content.js: extractTranscript - Successfully extracted actual response: "${responseText.substring(0, 100)}..."`);
                } else if (extractedText) {
                    console.log(`content.js: extractTranscript - Extracted text is still a placeholder: "${extractedText}"`);
                    responseText = '[Response still loading - contains placeholder text]';
                } else {
                    console.log(`content.js: extractTranscript - No text extracted from response element ${i + 1}`);
                }
            } else {
                console.log(`content.js: extractTranscript - No response element at index ${i}`);
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
        console.log('content.js: scrollConversationList - First attempt: [data-test-id="overflow-container"]:', scrollableElement);
        if (!scrollableElement) {
            scrollableElement = document.querySelector('.chat-history');
            console.log('content.js: scrollConversationList - Second attempt: .chat-history:', scrollableElement);
        }
        if (!scrollableElement) {
            scrollableElement = document.documentElement;
            console.log('content.js: scrollConversationList - Third attempt: document.documentElement:', scrollableElement);
        }
        if (!scrollableElement) {
            console.error('content.js: scrollConversationList - No suitable scrollable element found for dispatching wheel events. Cannot auto-scroll reliably.');
            return [];
        }
        console.log('content.js: scrollConversationList - Final scrollable element:', scrollableElement);
        console.log('content.js: scrollConversationList - Element tagName:', scrollableElement.tagName);
        console.log('content.js: scrollConversationList - Element classes:', scrollableElement.className);
        console.log('content.js: scrollConversationList - Element scrollHeight:', scrollableElement.scrollHeight);
        console.log('content.js: scrollConversationList - Element clientHeight:', scrollableElement.clientHeight);
        console.log('content.js: scrollConversationList - Element scrollTop:', scrollableElement.scrollTop);

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
            
            // Check if we're already at the bottom
            const isAtBottom = (currentScrollTop + currentClientHeight >= currentScrollHeight - 10);
            console.log(`content.js: scrollConversationList - Is at bottom before scroll: ${isAtBottom}`);

            // Scroll down by a small increment
            const newScrollTop = Math.min(scrollableElement.scrollTop + smallScrollIncrement, scrollableElement.scrollHeight);
            const oldScrollTop = scrollableElement.scrollTop;
            scrollableElement.scrollTop = newScrollTop;
            console.log(`content.js: scrollConversationList - Changed scrollTop from ${oldScrollTop} to ${newScrollTop} (requested: ${oldScrollTop + smallScrollIncrement})`);
            
            // Check scroll after setting
            const actualScrollTop = scrollableElement.scrollTop;
            console.log(`content.js: scrollConversationList - Actual scrollTop after setting: ${actualScrollTop}`);
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

            // Check scroll position after the operations
            const postScrollTop = scrollableElement.scrollTop;
            const postScrollHeight = scrollableElement.scrollHeight;
            const postClientHeight = scrollableElement.clientHeight;
            console.log(`content.js: scrollConversationList - AFTER scroll: scrollTop=${postScrollTop}, scrollHeight=${postScrollHeight}, clientHeight=${postClientHeight}`);
            
            const isAtBottomAfter = (postScrollTop + postClientHeight >= postScrollHeight - 10);
            console.log(`content.js: scrollConversationList - Is at bottom after scroll: ${isAtBottomAfter}`);
            
            if (postScrollTop === currentScrollTop && postScrollHeight === currentScrollHeight) {
                console.log(`content.js: scrollConversationList - No scroll movement detected. May have reached end.`);
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
                console.log(`content.js: scrollConversationList - No new items detected. Count: ${noNewItemsCount}. Current items: ${currentItemCount}, Previous: ${previousItemCount}`);
                
                // If we've tried many times with no new items, check for "Load more" buttons or similar
                if (noNewItemsCount > 10 && noNewItemsCount % 10 === 0) {
                    console.log(`content.js: scrollConversationList - Looking for load more buttons or pagination controls...`);
                    const loadMoreButtons = document.querySelectorAll('button, [role="button"]');
                    console.log(`content.js: scrollConversationList - Found ${loadMoreButtons.length} potential buttons`);
                    for (let button of loadMoreButtons) {
                        const buttonText = button.innerText.toLowerCase();
                        if (buttonText.includes('load') || buttonText.includes('more') || buttonText.includes('show')) {
                            console.log(`content.js: scrollConversationList - Found potential load more button: "${buttonText}"`, button);
                            button.click();
                            console.log(`content.js: scrollConversationList - Clicked load more button`);
                            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for loading
                            break;
                        }
                    }
                }

                // If we've been stuck for too long, try different scrolling strategies
                if (noNewItemsCount > 50 && noNewItemsCount % 25 === 0) {
                    console.log(`content.js: scrollConversationList - Trying alternative scrolling strategies...`);
                    
                    // Try scrolling different elements
                    const alternativeScrollables = [
                        document.querySelector('main'),
                        document.querySelector('[role="main"]'),
                        document.querySelector('.main-content'),
                        document.querySelector('.conversation-list'),
                        document.body
                    ];
                    
                    for (let element of alternativeScrollables) {
                        if (element && element !== scrollableElement) {
                            console.log(`content.js: scrollConversationList - Trying to scroll:`, element.tagName, element.className);
                            const oldScroll = element.scrollTop;
                            element.scrollTop += 200;
                            console.log(`content.js: scrollConversationList - Changed scrollTop from ${oldScroll} to ${element.scrollTop}`);
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }
                }
                
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
                console.log(`content.js: scrollConversationList - New items detected! Current: ${currentItemCount}, Previous: ${previousItemCount}`);
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
        console.log('content.js: processNextConversation - Found conversation elements:', conversationElements.length);
        let foundElement = null;

        // Iterate through conversation titles to find the one matching our target
        for (const element of conversationElements) {
            // Ensure consistent cleaning for comparison
            const cleanedElementText = element.innerText.trim().replace(/\u00A0/g, '');
            console.log(`content.js: processNextConversation - Checking element text: "${cleanedElementText}" vs target: "${targetTitle}"`);
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
                console.log('content.js: processNextConversation - Found clickable parent. About to click.');
                console.log('content.js: processNextConversation - Current URL before click:', window.location.href);
                
                // Simulate a click on the conversation item
                clickableParent.click();
                console.log('content.js: processNextConversation - Clicked conversation item.');

                // Wait for the page to load after clicking. This is crucial for transcript extraction.
                console.log(`content.js: processNextConversation - Waiting for page to load...`);
                
                // Wait longer and check for content to load
                let waitAttempts = 0;
                const maxWaitAttempts = 20; // Wait up to 4 seconds total
                let conversationContentFound = false;
                
                while (waitAttempts < maxWaitAttempts && !conversationContentFound) {
                    await new Promise(resolve => setTimeout(resolve, 200)); // Wait 200ms between checks
                    waitAttempts++;
                    
                    // Check if conversation content has loaded
                    const userQueries = document.querySelectorAll('user-query');
                    const modelResponses = document.querySelectorAll('model-response');
                    const altPrompts = document.querySelectorAll('[data-test-id="user-message"], .user-message, [role="user"]');
                    const altResponses = document.querySelectorAll('[data-test-id="assistant-message"], .assistant-message, [role="assistant"]');
                    
                    if (userQueries.length > 0 || modelResponses.length > 0 || altPrompts.length > 0 || altResponses.length > 0) {
                        conversationContentFound = true;
                        console.log(`content.js: processNextConversation - Content found after ${waitAttempts * 200}ms wait`);
                        
                        // Additional wait for response content to load (not just elements to appear)
                        const responsesToCheck = modelResponses.length > 0 ? modelResponses : altResponses;
                        if (responsesToCheck.length > 0) {
                            console.log('content.js: processNextConversation - Waiting for response content to finish loading...');
                            await waitForResponseContent(responsesToCheck, 3000); // Wait up to 3 seconds for content
                        }
                    } else {
                        console.log(`content.js: processNextConversation - Wait attempt ${waitAttempts}/${maxWaitAttempts} - no content yet`);
                    }
                }
                
                if (!conversationContentFound) {
                    console.warn('content.js: processNextConversation - No conversation content found after maximum wait time');
                }
                
                console.log('content.js: processNextConversation - Finished wait after click.');
                console.log('content.js: processNextConversation - Current URL after click and wait:', window.location.href);

                // --- Transcript Extraction Step ---
                console.log('content.js: processNextConversation - Starting transcript extraction...');
                const transcriptContent = extractTranscript();
                console.log('content.js: processNextConversation - Transcript extraction completed. Length:', transcriptContent.length);
                console.log('content.js: processNextConversation - Transcript preview (first 200 chars):', transcriptContent.substring(0, 200));
                
                collectedTranscripts.push({
                    title: targetTitle,
                    content: transcriptContent
                });
                console.log('content.js: processNextConversation - Transcript extracted and stored. Collected so far:', collectedTranscripts.length);

                // Navigate back to the search results page
                console.log('content.js: processNextConversation - Navigating back.');
                window.history.back();
                // Wait for the page to load after navigating back.
                console.log(`content.js: processNextConversation - Waiting for 100ms after back navigation.`);
                await new Promise(resolve => setTimeout(resolve, 100));
                console.log('content.js: processNextConversation - Finished wait after back navigation.');
                console.log('content.js: processNextConversation - Current URL after back navigation:', window.location.href);

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
            console.log('content.js: processNextConversation - Available titles:');
            conversationElements.forEach((el, i) => {
                console.log(`  ${i}: "${el.innerText.trim().replace(/\u00A0/g, '')}"`);
            });
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
