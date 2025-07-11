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
    let maxScrollAttempts = 10; // Default max scroll attempts to load full conversation
    let isSearchAborted = false; // Flag to control search abortion
    let automationRunning = false; // Flag to prevent multiple automation instances

    // New variable for artificial delay between scroll attempts for observation
    const scrollObservationDelayMs = 0; // Reduced to 0ms for minimal delay

    /**
     * Downloads a transcript file immediately
     * @param {string} title - The conversation title
     * @param {string} content - The transcript content
     * @param {string} savePrefix - The file prefix
     */
    function downloadTranscriptImmediately(title, content, savePrefix) {
        console.log('content.js: downloadTranscriptImmediately - Starting immediate download');
        console.log('content.js: Title:', title);
        console.log('content.js: Content length:', content.length);
        console.log('content.js: Save prefix:', savePrefix);
        
        try {
            // Sanitize filename
            function sanitizeFilename(title) {
                return title.replace(/[/\\?%*:|"<>]/g, '_')
                           .replace(/\s+/g, '_')
                           .toLowerCase();
            }
            
            const filename = savePrefix + sanitizeFilename(title) + '.txt';
            console.log('content.js: Sanitized filename:', filename);
            
            // Create blob and download
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            
            // Create and click download link
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = filename;
            downloadLink.style.display = 'none';
            
            console.log('content.js: Adding download link to DOM and clicking...');
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            
            console.log('content.js: ✅ Download initiated for:', filename);
            
            // Clean up blob URL after a delay
            setTimeout(() => {
                URL.revokeObjectURL(url);
                console.log('content.js: Blob URL cleaned up for:', filename);
            }, 1000);
            
            return true;
        } catch (error) {
            console.error('content.js: ❌ Error downloading transcript:', error);
            return false;
        }
    }

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
            'preparing response',
            'analyzing',
            'computing',
            '...',
            'wait',
            'gemini is thinking',
            'response in progress',
            'working',
            'busy'
        ];
        
        const cleanText = text.trim().toLowerCase();
        
        // Very short responses are likely incomplete or placeholders
        if (cleanText.length < 5) {
            return true;
        }
        
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
        
        // Check if it's mostly dots or whitespace (loading indicators)
        if (/^[\s\.]+$/.test(cleanText)) {
            return true;
        }
        
        // Check for common loading/placeholder patterns
        const isPlaceholder = placeholderIndicators.some(indicator => 
            cleanText === indicator.toLowerCase() || 
            cleanText.startsWith(indicator.toLowerCase()) ||
            cleanText.includes(indicator.toLowerCase() + '...')
        );
        
        // Additional check: If the text is very short and contains only common placeholder words
        if (cleanText.length < 20) {
            const commonPlaceholderWords = ['loading', 'wait', 'thinking', 'generating', 'processing'];
            if (commonPlaceholderWords.some(word => cleanText.includes(word))) {
                return true;
            }
        }
        
        return isPlaceholder;
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
        console.log('content.js: waitForResponseContent - Starting wait for response content');
        console.log('content.js: waitForResponseContent - Response elements to check:', responseElements.length);
        console.log('content.js: waitForResponseContent - Max wait time:', maxWaitMs, 'ms');
        
        // If no response elements, consider it successful
        if (!responseElements || responseElements.length === 0) {
            console.log('content.js: waitForResponseContent - No response elements to check, returning true');
            return true;
        }
        
        const startTime = Date.now();
        const checkInterval = 500; // Check every 500ms
        let checkCount = 0;
        
        while (Date.now() - startTime < maxWaitMs) {
            checkCount++;
            let hasValidResponses = true;
            let placeholderCount = 0;
            let loadingCount = 0;
            let validCount = 0;
            
            console.log(`content.js: waitForResponseContent - Check #${checkCount} (${Date.now() - startTime}ms elapsed)`);
            
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
                
                console.log(`content.js: waitForResponseContent - Response ${i + 1} text preview: "${responseText.substring(0, 100)}..."`);
                
                if (!responseText || responseText.length < 10) {
                    console.log(`content.js: waitForResponseContent - Response ${i + 1} has minimal content (${responseText.length} chars)`);
                    loadingCount++;
                    hasValidResponses = false;
                } else if (isPlaceholderResponse(responseText)) {
                    console.log(`content.js: waitForResponseContent - Response ${i + 1} still shows placeholder: "${responseText}"`);
                    placeholderCount++;
                    hasValidResponses = false;
                } else {
                    console.log(`content.js: waitForResponseContent - Response ${i + 1} appears valid (${responseText.length} chars)`);
                    validCount++;
                }
            }
            
            console.log(`content.js: waitForResponseContent - Check results: ${validCount} valid, ${placeholderCount} placeholder, ${loadingCount} loading`);
            
            if (hasValidResponses && responseElements.length > 0) {
                console.log('content.js: waitForResponseContent - All responses appear to have valid content');
                return true;
            }
            
            // If we have some valid responses and some still loading, that's often OK for extraction
            if (validCount > 0 && (placeholderCount + loadingCount) <= 2) {
                console.log('content.js: waitForResponseContent - Most responses are valid, proceeding with extraction');
                return true;
            }
            
            console.log(`content.js: waitForResponseContent - Still waiting for content... (${Date.now() - startTime}ms elapsed)`);
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        
        console.warn('content.js: waitForResponseContent - Timeout waiting for response content');
        console.warn('content.js: waitForResponseContent - Final state after timeout:');
        console.warn('content.js: waitForResponseContent - - Total response elements:', responseElements.length);
        
        // Log final state of each response for debugging
        for (let i = 0; i < Math.min(responseElements.length, 5); i++) {
            const element = responseElements[i];
            const messageContent = element.querySelector('message-content');
            const responseText = messageContent ? messageContent.innerText.trim() : element.innerText.trim();
            console.warn(`content.js: waitForResponseContent - Response ${i + 1} final state: "${responseText.substring(0, 200)}..."`);
        }
        
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
        
        // Strategy 1: Try to find conversation elements in DOM order
        const conversationContainer = document.querySelector('main') || 
                                    document.querySelector('[role="main"]') ||
                                    document.querySelector('.conversation-container') ||
                                    document.querySelector('.chat-container') ||
                                    document.body;
        
        // Get all conversation elements (both prompts and responses) in DOM order
        const allConversationElements = conversationContainer.querySelectorAll([
            'user-query',
            'model-response',
            '[data-test-id="user-message"]',
            '[data-test-id="assistant-message"]',
            '.user-message',
            '.assistant-message',
            '[role="user"]',
            '[role="assistant"]'
        ].join(', '));
        
        console.log('content.js: extractTranscript - Found conversation elements in DOM order:', allConversationElements.length);
        
        if (allConversationElements.length > 0) {
            console.log('content.js: extractTranscript - Processing elements in DOM order');
            
            let promptCounter = 0;
            let responseCounter = 0;
            
            allConversationElements.forEach((element, index) => {
                const tagName = element.tagName.toLowerCase();
                const role = element.getAttribute('role');
                const testId = element.getAttribute('data-test-id');
                const className = element.className || '';
                
                console.log(`content.js: extractTranscript - Processing element ${index + 1}: ${tagName}, role=${role}, testId=${testId}, class=${className}`);
                
                // Determine if this is a prompt or response
                const isPrompt = tagName === 'user-query' || 
                               role === 'user' ||
                               testId === 'user-message' ||
                               className.includes('user-message');
                
                const isResponse = tagName === 'model-response' ||
                                 role === 'assistant' ||
                                 testId === 'assistant-message' ||
                                 className.includes('assistant-message');
                
                if (isPrompt) {
                    promptCounter++;
                    let promptText = '[Prompt not found]';
                    
                    // Try multiple extraction methods for prompts
                    const p = element.querySelector('.user-query-bubble-with-background .query-text p');
                    if (p && p.innerText.trim()) {
                        promptText = p.innerText.trim();
                        console.log(`content.js: extractTranscript - Found prompt via p tag: "${promptText.substring(0, 100)}..."`);
                    } else {
                        const allText = element.innerText.trim();
                        if (allText) {
                            promptText = allText;
                            console.log(`content.js: extractTranscript - Found prompt via innerText: "${promptText.substring(0, 100)}..."`);
                        }
                    }
                    
                    transcript += `--- PROMPT ${promptCounter} ---\n${promptText}\n\n`;
                    
                } else if (isResponse) {
                    responseCounter++;
                    let responseText = '[Response not found]';
                    
                    // Use extractActualResponse to properly handle "Show thinking" and get only the final response
                    const extractedText = extractActualResponse(element);
                    if (extractedText && !isPlaceholderResponse(extractedText)) {
                        responseText = extractedText;
                        console.log(`content.js: extractTranscript - Successfully extracted actual response: "${responseText.substring(0, 100)}..."`);
                    } else if (extractedText) {
                        console.log(`content.js: extractTranscript - Extracted text is still a placeholder: "${extractedText}"`);
                        responseText = '[Response still loading - contains placeholder text]';
                    }
                    
                    transcript += `--- RESPONSE ${responseCounter} ---\n${responseText}\n\n`;
                } else {
                    console.log(`content.js: extractTranscript - Skipping unrecognized element: ${tagName}`);
                }
            });
            
            console.log(`content.js: extractTranscript - Processed ${promptCounter} prompts and ${responseCounter} responses in DOM order`);
            
        } else {
            // Fallback to original pairing strategy
            console.log('content.js: extractTranscript - No elements found in DOM order, falling back to original strategy');
            
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
            } else {
                // Original pairing logic for fallback
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
            }
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
    /**
     * Extracts a single transcript by title and downloads it immediately
     * @param {string} targetTitle - The title of the conversation to extract
     * @param {number} currentIndex - Current extraction index (0-based)
     * @param {number} totalCount - Total number of transcripts to extract
     */
    async function extractSingleTranscriptByTitle(targetTitle, currentIndex, totalCount) {
        console.log(`content.js: extractSingleTranscriptByTitle - Starting extraction for: "${targetTitle}"`);
        console.log(`content.js: Progress: ${currentIndex + 1}/${totalCount}`);
        
        try {
            // Send processing message to popup
            chrome.runtime.sendMessage({
                action: "processingTitle",
                title: targetTitle,
                current: currentIndex + 1,
                total: totalCount
            });
            
            // Find and click the conversation
            console.log('content.js: extractSingleTranscriptByTitle - Looking for conversation elements...');
            
            // Use more specific selectors that exclude avatar/account buttons
            const conversationElements = document.querySelectorAll(`
                [data-test-id="conversation"], 
                .conversation-title, 
                a[href*="/app/"]:not([href*="SignOutOptions"]):not([href*="accounts.google.com"]):not(.gb_B):not(.gb_Za), 
                a[href*="/chat/"]:not([href*="SignOutOptions"]):not([href*="accounts.google.com"]):not(.gb_B):not(.gb_Za)
            `.replace(/\s+/g, ' ').trim());
            console.log('content.js: extractSingleTranscriptByTitle - Found conversation elements:', conversationElements.length);
            
            // Debug: Log the first few elements to see what we're working with
            for (let i = 0; i < Math.min(5, conversationElements.length); i++) {
                const element = conversationElements[i];
                console.log(`content.js: extractSingleTranscriptByTitle - Element ${i}:`, {
                    tagName: element.tagName,
                    className: element.className,
                    textContent: element.textContent?.trim().substring(0, 100),
                    href: element.href
                });
            }
            
            let foundElement = null;
            for (const element of conversationElements) {
                const elementText = element.innerText?.trim().replace(/\u00A0/g, '') || '';
                const cleanedElementText = elementText.toLowerCase().replace(/[^\w\s]/g, '').trim();
                const cleanedTargetTitle = targetTitle.toLowerCase().replace(/[^\w\s]/g, '').trim();
                
                console.log(`content.js: extractSingleTranscriptByTitle - Checking: "${cleanedElementText.substring(0, 50)}..." vs "${cleanedTargetTitle}"`);
                
                // Try multiple matching strategies
                const exactMatch = cleanedElementText === cleanedTargetTitle;
                const containsMatch = cleanedElementText.includes(cleanedTargetTitle);
                const reverseContainsMatch = cleanedTargetTitle.includes(cleanedElementText);
                const wordsMatch = cleanedTargetTitle.split(' ').every(word => cleanedElementText.includes(word));
                
                if (exactMatch || containsMatch || reverseContainsMatch || wordsMatch) {
                    // Safety check: make sure this looks like a conversation element
                    const elementClasses = element.className?.toLowerCase() || '';
                    const elementId = element.id?.toLowerCase() || '';
                    const href = element.href || '';
                    
                    const isUnsafeElement = 
                        elementClasses.includes('avatar') ||
                        elementClasses.includes('profile') ||
                        elementClasses.includes('menu') ||
                        elementClasses.includes('dropdown') ||
                        elementClasses.includes('header') ||
                        elementClasses.includes('gb_') ||
                        href.includes('SignOutOptions') ||
                        href.includes('accounts.google.com') ||
                        elementId.includes('avatar') ||
                        elementId.includes('profile');
                    
                    const isConversationElement = 
                        href.includes('/app/') ||
                        href.includes('/chat/') ||
                        elementClasses.includes('conversation') ||
                        element.hasAttribute('data-test-id');
                    
                    if (isUnsafeElement) {
                        console.warn('content.js: extractSingleTranscriptByTitle - Skipping unsafe element:', {
                            text: elementText.substring(0, 50),
                            className: elementClasses,
                            id: elementId
                        });
                        continue;
                    }
                    
                    foundElement = element;
                    console.log('content.js: extractSingleTranscriptByTitle - Found matching element using strategy:', {
                        exactMatch, containsMatch, reverseContainsMatch, wordsMatch,
                        isConversationElement,
                        href: href
                    });
                    break;
                }
            }
            
            if (!foundElement) {
                console.warn('content.js: extractSingleTranscriptByTitle - First selector failed, trying broader selectors...');
                
                // Try broader selectors
                const allLinks = document.querySelectorAll('a');
                const allClickableElements = document.querySelectorAll('div[role="button"], button, [onclick]');
                const combinedElements = [...allLinks, ...allClickableElements];
                
                console.log('content.js: extractSingleTranscriptByTitle - Trying broader search with', combinedElements.length, 'elements');
                
                for (const element of combinedElements) {
                    const elementText = element.innerText?.trim().replace(/\u00A0/g, '') || '';
                    const cleanedElementText = elementText.toLowerCase().replace(/[^\w\s]/g, '').trim();
                    const cleanedTargetTitle = targetTitle.toLowerCase().replace(/[^\w\s]/g, '').trim();
                    
                    // Only check elements that have meaningful text content
                    if (elementText.length > 10 && elementText.length < 200) {
                        const wordsMatch = cleanedTargetTitle.split(' ').every(word => 
                            word.length > 2 && cleanedElementText.includes(word)
                        );
                        
                        if (wordsMatch) {
                            foundElement = element;
                            console.log('content.js: extractSingleTranscriptByTitle - Found matching element with broader search:', elementText.substring(0, 100));
                            
                            // Safety check: make sure we're not clicking on user avatar or menu elements
                            const elementClasses = element.className?.toLowerCase() || '';
                            const elementId = element.id?.toLowerCase() || '';
                            const parentClasses = element.parentElement?.className?.toLowerCase() || '';
                            
                            const isUnsafeElement = 
                                elementClasses.includes('avatar') ||
                                elementClasses.includes('profile') ||
                                elementClasses.includes('menu') ||
                                elementClasses.includes('dropdown') ||
                                elementId.includes('avatar') ||
                                elementId.includes('profile') ||
                                parentClasses.includes('avatar') ||
                                parentClasses.includes('profile');
                            
                            if (isUnsafeElement) {
                                console.warn('content.js: extractSingleTranscriptByTitle - Skipping unsafe element (avatar/menu):', {
                                    className: elementClasses,
                                    id: elementId,
                                    parentClassName: parentClasses
                                });
                                foundElement = null;
                                continue;
                            }
                            
                            break;
                        }
                    }
                }
            }
            
            if (!foundElement) {
                console.error('content.js: extractSingleTranscriptByTitle - Could not find conversation element for:', targetTitle);
                chrome.runtime.sendMessage({
                    action: "singleTranscriptComplete",
                    title: targetTitle,
                    downloadSuccess: false,
                    error: "Conversation not found in list"
                });
                automationRunning = false;
                return;
            }
            
            // Final safety check before clicking
            const finalSafetyCheck = () => {
                const classes = foundElement.className?.toLowerCase() || '';
                const id = foundElement.id?.toLowerCase() || '';
                const href = foundElement.href || '';
                const text = foundElement.textContent?.trim() || '';
                
                // Red flags that suggest this is NOT a conversation element
                const redFlags = [
                    classes.includes('avatar'),
                    classes.includes('profile'),
                    classes.includes('menu'),
                    classes.includes('dropdown'),
                    classes.includes('header'),
                    classes.includes('nav'),
                    classes.includes('gb_'), // Google bar elements
                    href.includes('SignOutOptions'),
                    href.includes('accounts.google.com'),
                    id.includes('avatar'),
                    id.includes('profile'),
                    text.length < 5,
                    text.toLowerCase().includes('sign out'),
                    text.toLowerCase().includes('account'),
                    text.toLowerCase().includes('settings')
                ];
                
                const hasRedFlags = redFlags.some(flag => flag);
                
                // Green flags that suggest this IS a conversation element
                const greenFlags = [
                    href.includes('/app/'),
                    href.includes('/chat/'),
                    classes.includes('conversation'),
                    foundElement.hasAttribute('data-test-id'),
                    text.length > 20 && text.length < 200
                ];
                
                const hasGreenFlags = greenFlags.some(flag => flag);
                
                console.log('content.js: extractSingleTranscriptByTitle - Final safety check:', {
                    redFlags: redFlags.filter(flag => flag).length,
                    greenFlags: greenFlags.filter(flag => flag).length,
                    hasRedFlags,
                    hasGreenFlags,
                    element: {
                        tagName: foundElement.tagName,
                        className: classes,
                        id: id,
                        href: href,
                        text: text.substring(0, 50)
                    }
                });
                
                // Relaxed safety check: Allow clicking if green flags are present, even if red flags exist
                // Only block if there are red flags but NO green flags, or if there are critical red flags
                const criticalRedFlags = [
                    text.toLowerCase().includes('sign out'),
                    text.toLowerCase().includes('account'),
                    text.toLowerCase().includes('settings'),
                    classes.includes('gb_'), // Google bar elements are always critical
                    href.includes('SignOutOptions'),
                    href.includes('accounts.google.com'),
                    classes.includes('menu') && !href.includes('/app/'),
                    classes.includes('dropdown') && !href.includes('/app/')
                ];
                
                const hasCriticalRedFlags = criticalRedFlags.some(flag => flag);
                
                console.log('content.js: extractSingleTranscriptByTitle - Relaxed safety check details:', {
                    criticalRedFlags: criticalRedFlags.filter(flag => flag).length,
                    hasCriticalRedFlags,
                    decision: !hasCriticalRedFlags && (hasGreenFlags || !hasRedFlags)
                });
                
                // Block if there are critical red flags (these are always bad)
                // Otherwise, allow if we have green flags, or if no red flags at all
                return !hasCriticalRedFlags && (hasGreenFlags || !hasRedFlags);
            };
            
            if (!finalSafetyCheck()) {
                console.error('content.js: extractSingleTranscriptByTitle - Element failed relaxed safety check - aborting click');
                chrome.runtime.sendMessage({
                    action: "singleTranscriptComplete",
                    title: targetTitle,
                    downloadSuccess: false,
                    error: "Found element failed relaxed safety check - has critical red flags without green flags"
                });
                automationRunning = false;
                return;
            }
            
            // Click the conversation
            console.log('content.js: extractSingleTranscriptByTitle - About to click conversation element');
            console.log('content.js: extractSingleTranscriptByTitle - Element details:', {
                tagName: foundElement.tagName,
                className: foundElement.className,
                id: foundElement.id,
                href: foundElement.href,
                innerHTML: foundElement.innerHTML?.substring(0, 200),
                textContent: foundElement.textContent?.substring(0, 100),
                offsetTop: foundElement.offsetTop,
                offsetLeft: foundElement.offsetLeft,
                clientWidth: foundElement.clientWidth,
                clientHeight: foundElement.clientHeight
            });
            
            // Check if the element is actually visible and clickable
            const rect = foundElement.getBoundingClientRect();
            console.log('content.js: extractSingleTranscriptByTitle - Element position:', {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                visible: rect.width > 0 && rect.height > 0,
                inViewport: rect.top >= 0 && rect.left >= 0 && rect.top < window.innerHeight && rect.left < window.innerWidth
            });
            
            // Scroll the element into view first
            console.log('content.js: extractSingleTranscriptByTitle - Scrolling element into view...');
            foundElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Wait a moment for scroll to complete
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Try different click methods to avoid misdirection
            console.log('content.js: extractSingleTranscriptByTitle - Attempting click...');
            
            try {
                // Method 1: Direct click
                console.log('content.js: extractSingleTranscriptByTitle - Trying direct click...');
                foundElement.click();
                console.log('content.js: extractSingleTranscriptByTitle - Direct click completed');
            } catch (error) {
                console.error('content.js: extractSingleTranscriptByTitle - Direct click failed:', error);
                
                // Method 2: Programmatic click event
                console.log('content.js: extractSingleTranscriptByTitle - Trying programmatic click event...');
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                foundElement.dispatchEvent(clickEvent);
                console.log('content.js: extractSingleTranscriptByTitle - Programmatic click completed');
            }
            
            // Wait for page to load
            console.log('content.js: extractSingleTranscriptByTitle - Waiting for conversation to load...');
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second wait
            
            // Wait for content to be ready
            const maxWaitAttempts = 15;
            let waitAttempts = 0;
            let conversationContentFound = false;
            
            while (waitAttempts < maxWaitAttempts && !conversationContentFound) {
                waitAttempts++;
                const userQueries = document.querySelectorAll('user-query');
                const modelResponses = document.querySelectorAll('model-response');
                
                if (userQueries.length > 0 || modelResponses.length > 0) {
                    conversationContentFound = true;
                    console.log(`content.js: extractSingleTranscriptByTitle - Content found after ${waitAttempts} attempts`);
                } else {
                    console.log(`content.js: extractSingleTranscriptByTitle - Wait attempt ${waitAttempts}/${maxWaitAttempts}`);
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
            
            if (!conversationContentFound) {
                console.warn('content.js: extractSingleTranscriptByTitle - No content found after waiting');
            }
            
            // Load complete conversation by scrolling
            console.log('content.js: extractSingleTranscriptByTitle - Loading complete conversation...');
            await loadCompleteConversation(maxScrollAttempts, 1000);
            
            // Extract transcript
            console.log('content.js: extractSingleTranscriptByTitle - Extracting transcript...');
            const transcriptContent = extractTranscript();
            console.log('content.js: extractSingleTranscriptByTitle - Transcript length:', transcriptContent.length);
            
            // Download immediately
            console.log('content.js: extractSingleTranscriptByTitle - Downloading transcript...');
            const downloadSuccess = downloadTranscriptImmediately(targetTitle, transcriptContent, globalSavePrefix);
            
            // Store the transcript
            const transcript = {
                title: targetTitle,
                content: transcriptContent,
                timestamp: new Date().toISOString(),
                downloaded: downloadSuccess
            };
            collectedTranscripts.push(transcript);
            
            // Navigate back
            console.log('content.js: extractSingleTranscriptByTitle - Navigating back...');
            window.history.back();
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for back navigation
            
            // Send completion message
            chrome.runtime.sendMessage({
                action: "singleTranscriptComplete",
                title: targetTitle,
                downloadSuccess: downloadSuccess,
                transcriptLength: transcriptContent.length
            });
            
            console.log('content.js: extractSingleTranscriptByTitle - Single transcript extraction complete');
            
        } catch (error) {
            console.error('content.js: extractSingleTranscriptByTitle - Error:', error);
            chrome.runtime.sendMessage({
                action: "singleTranscriptComplete",
                title: targetTitle,
                downloadSuccess: false,
                error: error.message
            });
        } finally {
            automationRunning = false;
        }
    }

    async function processNextConversation() {
        console.log(`content.js: processNextConversation - Called for index ${currentIndex} of ${titlesToProcess.length}.`);

        // Check if automation was aborted
        if (isSearchAborted) {
            console.warn('content.js: processNextConversation - Automation aborted by user.');
            automationRunning = false; // Reset automation flag
            chrome.runtime.sendMessage({ action: "searchAborted" });
            return;
        }

        // Check if all titles have been processed
        if (currentIndex >= titlesToProcess.length) {
            console.log('content.js: processNextConversation - All titles processed. Sending automationComplete message.');
            automationRunning = false; // Reset automation flag
            
            // Add a small delay to let the browser stabilize before sending completion message
            setTimeout(() => {
                // Force garbage collection if available (helps with memory)
                if (window.gc) {
                    try {
                        window.gc();
                        console.log('content.js: processNextConversation - Garbage collection triggered');
                    } catch (e) {
                        console.log('content.js: processNextConversation - Garbage collection not available');
                    }
                }
                
                // Send only metadata to popup.js, keep actual content in content script
                const transcriptMetadata = collectedTranscripts.map((transcript, index) => ({
                    id: index,
                    title: transcript.title,
                    length: transcript.content.length,
                    preview: transcript.content.substring(0, 200) + '...'
                }));
                
                chrome.runtime.sendMessage({
                    action: "automationComplete",
                    message: "All search result conversations processed. Transcripts ready for download.",
                    transcripts: transcriptMetadata // Send only metadata
                });
                console.log('content.js: processNextConversation - "automationComplete" message sent with metadata for', transcriptMetadata.length, 'transcripts.');
            }, 500); // 500ms delay to let browser stabilize
            
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
                            const contentReady = await waitForResponseContent(responsesToCheck, 3000); // Wait up to 3 seconds for content
                            if (!contentReady) {
                                console.warn('content.js: processNextConversation - Response content wait timed out, proceeding anyway');
                                console.warn('content.js: processNextConversation - This is normal for some conversations where content loads differently');
                            } else {
                                console.log('content.js: processNextConversation - Response content appears ready');
                            }
                        } else {
                            console.log('content.js: processNextConversation - No responses to check, proceeding with extraction');
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

                // --- Load Complete Conversation Step ---
                console.log('content.js: processNextConversation - Loading complete conversation by scrolling up...');
                const totalElements = await loadCompleteConversation(maxScrollAttempts, 1000); // Use user-configured attempts, 1 second delay
                console.log('content.js: processNextConversation - Complete conversation loaded. Total elements:', totalElements);

                // --- Transcript Extraction Step ---
                console.log('content.js: processNextConversation - Starting transcript extraction...');
                const transcriptContent = extractTranscript();
                console.log('content.js: processNextConversation - Transcript extraction completed. Length:', transcriptContent.length);
                console.log('content.js: processNextConversation - Transcript preview (first 200 chars):', transcriptContent.substring(0, 200));
                
                // Validate transcript content
                if (transcriptContent.length < 50) {
                    console.warn('content.js: processNextConversation - Warning: Very short transcript extracted (likely incomplete)');
                    console.warn('content.js: processNextConversation - This might indicate the conversation content did not fully load');
                } else {
                    console.log('content.js: processNextConversation - Transcript appears to have substantial content');
                }
                
                // IMMEDIATE DOWNLOAD: Download the transcript file right after extraction
                console.log('content.js: processNextConversation - ⬇️ DOWNLOADING TRANSCRIPT IMMEDIATELY');
                const downloadSuccess = downloadTranscriptImmediately(targetTitle, transcriptContent, globalSavePrefix);
                console.log('content.js: processNextConversation - Download result:', downloadSuccess ? 'SUCCESS' : 'FAILED');
                
                // Add timestamp for tracking
                const transcript = {
                    title: targetTitle,
                    content: transcriptContent,
                    timestamp: new Date().toISOString(),
                    downloaded: downloadSuccess
                };
                
                collectedTranscripts.push(transcript);
                console.log('content.js: processNextConversation - Transcript extracted, downloaded, and stored. Collected so far:', collectedTranscripts.length);

                // Navigate back to the search results page
                console.log('content.js: processNextConversation - Navigating back.');
                window.history.back();
                // Wait for the page to load after navigating back.
                console.log(`content.js: processNextConversation - Waiting for 500ms after back navigation.`);
                await new Promise(resolve => setTimeout(resolve, 500)); // Increased from 100ms to 500ms
                console.log('content.js: processNextConversation - Finished wait after back navigation.');
                console.log('content.js: processNextConversation - Current URL after back navigation:', window.location.href);

                // Add a small delay before processing next conversation to prevent browser overload
                console.log('content.js: processNextConversation - Adding stability delay before next conversation...');
                await new Promise(resolve => setTimeout(resolve, 200)); // 200ms stability delay

                currentIndex++; // Move to the next title
                console.log('content.js: processNextConversation - Incrementing index to', currentIndex);
                
                // Use setTimeout to prevent call stack buildup
                setTimeout(() => {
                    processNextConversation(); // Continue with the next title
                }, 100); // Small delay to prevent stack overflow

            } else {
                console.warn('content.js: processNextConversation - Clickable parent not found for title:', targetTitle);
                // If the clickable parent was not found, report an error and move to the next title
                chrome.runtime.sendMessage({ action: "titleNotFoundInList", title: targetTitle, reason: "Clickable parent element not found for this title." });
                currentIndex++; // Move to the next title
                setTimeout(() => {
                    processNextConversation(); // Use setTimeout to prevent stack buildup
                }, 100);
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
            setTimeout(() => {
                processNextConversation(); // Use setTimeout to prevent stack buildup
            }, 100);
        }
    }

    /**
     * Scrolls up in the conversation to load all historical content
     * Gemini conversations load incrementally as you scroll up
     */
    async function loadCompleteConversation(maxScrollAttempts = 10, scrollDelayMs = 1000) {
        console.log('content.js: loadCompleteConversation - Starting to load complete conversation');
        
        let previousElementCount = 0;
        let stableCount = 0;
        const maxStableAttempts = 3; // Stop if count is stable for 3 attempts
        
        for (let attempt = 0; attempt < maxScrollAttempts; attempt++) {
            // Count current conversation elements
            const userQueries = document.querySelectorAll('user-query');
            const modelResponses = document.querySelectorAll('model-response');
            const altPrompts = document.querySelectorAll('[data-test-id="user-message"], .user-message, [role="user"]');
            const altResponses = document.querySelectorAll('[data-test-id="assistant-message"], .assistant-message, [role="assistant"]');
            
            const currentElementCount = userQueries.length + modelResponses.length + altPrompts.length + altResponses.length;
            console.log(`content.js: loadCompleteConversation - Attempt ${attempt + 1}: Found ${currentElementCount} conversation elements`);
            console.log(`content.js: loadCompleteConversation - Breakdown: userQueries=${userQueries.length}, modelResponses=${modelResponses.length}, altPrompts=${altPrompts.length}, altResponses=${altResponses.length}`);
            
            // Check if we've loaded more content
            if (currentElementCount === previousElementCount) {
                stableCount++;
                console.log(`content.js: loadCompleteConversation - Element count stable (${stableCount}/${maxStableAttempts})`);
                
                if (stableCount >= maxStableAttempts) {
                    console.log('content.js: loadCompleteConversation - Element count has been stable, assuming complete conversation loaded');
                    break;
                }
            } else {
                stableCount = 0; // Reset stable count since we found new content
                console.log(`content.js: loadCompleteConversation - Found new content, continuing (${currentElementCount} vs previous ${previousElementCount})`);
            }
            
            previousElementCount = currentElementCount;
            
            // Scroll to the very top of the page to trigger loading of older content
            console.log(`content.js: loadCompleteConversation - Scrolling to top (attempt ${attempt + 1})`);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            // Also try scrolling within the main conversation container if it exists
            const conversationContainer = document.querySelector('main') || 
                                        document.querySelector('[role="main"]') ||
                                        document.querySelector('.conversation-container') ||
                                        document.querySelector('.chat-container');
            
            if (conversationContainer) {
                console.log('content.js: loadCompleteConversation - Also scrolling conversation container to top');
                conversationContainer.scrollTo({ top: 0, behavior: 'smooth' });
            }
            
            // Wait for content to load
            console.log(`content.js: loadCompleteConversation - Waiting ${scrollDelayMs}ms for content to load`);
            await new Promise(resolve => setTimeout(resolve, scrollDelayMs));
            
            // Additional check: look for loading indicators
            const loadingIndicators = document.querySelectorAll([
                '.loading',
                '.spinner',
                '[data-loading="true"]',
                '.conversation-loading'
            ].join(', '));
            
            if (loadingIndicators.length > 0) {
                console.log(`content.js: loadCompleteConversation - Found ${loadingIndicators.length} loading indicators, waiting additional time`);
                await new Promise(resolve => setTimeout(resolve, scrollDelayMs / 2));
            }
        }
        
        // Final count after loading
        const finalUserQueries = document.querySelectorAll('user-query');
        const finalModelResponses = document.querySelectorAll('model-response');
        const finalAltPrompts = document.querySelectorAll('[data-test-id="user-message"], .user-message, [role="user"]');
        const finalAltResponses = document.querySelectorAll('[data-test-id="assistant-message"], .assistant-message, [role="assistant"]');
        
        const finalElementCount = finalUserQueries.length + finalModelResponses.length + finalAltPrompts.length + finalAltResponses.length;
        console.log(`content.js: loadCompleteConversation - Completed loading. Final count: ${finalElementCount} elements`);
        console.log(`content.js: loadCompleteConversation - Final breakdown: userQueries=${finalUserQueries.length}, modelResponses=${finalModelResponses.length}, altPrompts=${finalAltPrompts.length}, altResponses=${finalAltResponses.length}`);
        
        return finalElementCount;
    }

    // Listener for messages from popup.js
    chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
        console.log('content.js: ====== MESSAGE RECEIVED ======');
        console.log('content.js: Action:', request.action);
        console.log('content.js: Full request:', request);
        console.log('content.js: Sender:', sender);
        console.log('content.js: Timestamp:', new Date().toISOString());

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
        } else if (request.action === "extractSingleTranscript") {
            console.log('content.js: ============ EXTRACT SINGLE TRANSCRIPT START ============');
            console.log('content.js: Received "extractSingleTranscript" message');
            console.log('content.js: Target title:', request.targetTitle);
            console.log('content.js: Save prefix:', request.savePrefix);
            console.log('content.js: Current index:', request.currentIndex);
            console.log('content.js: Total count:', request.totalCount);
            
            if (automationRunning) {
                console.warn('content.js: extractSingleTranscript - Another extraction is already running. Ignoring request.');
                sendResponse({ success: false, error: "Another extraction is already running" });
                return true;
            }
            
            automationRunning = true;
            globalSavePrefix = request.savePrefix;
            pauseDurationMs = request.pauseDuration || 500;
            
            // Extract just this one transcript
            extractSingleTranscriptByTitle(request.targetTitle, request.currentIndex, request.totalCount);
            
            sendResponse({ success: true });
            return true;
        } else if (request.action === "startAutomation") {
            console.log('content.js: Received "startAutomation" message.');
            
            // Check if automation is already running
            if (automationRunning) {
                console.warn('content.js: startAutomation - Automation is already running. Ignoring request.');
                chrome.runtime.sendMessage({ action: "automationComplete", message: "Automation is already in progress. Please wait for it to complete." });
                return;
            }
            
            automationRunning = true;
            isSearchAborted = false; // Reset abort flag
            currentIndex = 0; // Reset index
            collectedTranscripts = []; // Reset collected transcripts
            
            globalSavePrefix = request.savePrefix || '';
            pauseDurationMs = request.pauseDuration || 500;
            maxScrollAttempts = request.scrollAttempts || 10;
            console.log('content.js: startAutomation - Global save prefix:', globalSavePrefix, 'Pause duration (ms):', pauseDurationMs, 'Max scroll attempts:', maxScrollAttempts);

            if (titlesToProcess.length > 0) {
                console.log('content.js: startAutomation - Initiating processNextConversation.');
                processNextConversation();
            } else {
                console.log('content.js: startAutomation - No titles to process. Sending "automationComplete".');
                automationRunning = false; // Reset flag
                chrome.runtime.sendMessage({ action: "automationComplete", message: "No search result titles were found to process for automation." });
            }
        } else if (request.action === "abortSearch") { // New listener for abort message
            console.log('content.js: Received "abortSearch" message. Setting isSearchAborted to true.');
            isSearchAborted = true; // Set the flag to true to stop the scrolling loop
        } else if (request.action === "getTranscriptContent") { // New listener for retrieving transcript content
            console.log('content.js: Received "getTranscriptContent" message for ID:', request.transcriptId);
            const transcriptId = request.transcriptId;
            if (transcriptId >= 0 && transcriptId < collectedTranscripts.length) {
                const transcript = collectedTranscripts[transcriptId];
                sendResponse({
                    content: transcript.content
                });
                console.log('content.js: Sent transcript content for ID:', transcriptId, 'Length:', transcript.content.length);
            } else {
                console.error('content.js: Invalid transcript ID requested:', transcriptId);
                sendResponse({
                    error: "Invalid transcript ID"
                });
            }
        } else if (request.action === "downloadAllTranscripts") { // New listener for handling downloads
            console.log('content.js: ============ DOWNLOAD ALL TRANSCRIPTS HANDLER START ============');
            console.log('content.js: Received "downloadAllTranscripts" message');
            console.log('content.js: Full request object:', request);
            console.log('content.js: Save prefix:', request.savePrefix);
            console.log('content.js: Number of transcripts:', collectedTranscripts.length);
            
            if (collectedTranscripts.length === 0) {
                console.error('content.js: No transcripts available');
                sendResponse({ 
                    success: false, 
                    error: "No transcripts available",
                    transcriptCount: 0
                });
                return true;
            }
            
            // Count how many were already downloaded during extraction
            const downloadedCount = collectedTranscripts.filter(t => t.downloaded).length;
            const totalCount = collectedTranscripts.length;
            
            console.log('content.js: Transcripts already downloaded during extraction:', downloadedCount);
            console.log('content.js: Total transcripts:', totalCount);
            
            if (downloadedCount === totalCount) {
                console.log('content.js: ✅ All transcripts were already downloaded during extraction!');
                sendResponse({ 
                    success: true, 
                    downloadCount: downloadedCount,
                    totalTranscripts: totalCount,
                    message: "All transcripts were downloaded during extraction",
                    alreadyDownloaded: true
                });
            } else {
                console.log('content.js: ⚠️ Some transcripts were not downloaded during extraction');
                console.log('content.js: This should not happen with the new immediate download system');
                sendResponse({ 
                    success: false, 
                    downloadCount: downloadedCount,
                    totalTranscripts: totalCount,
                    error: "Some transcripts were not downloaded during extraction",
                    alreadyDownloaded: false
                });
            }
            return true;
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
        } else if (request.action === "getTranscriptContent") { // New listener for retrieving transcript content
            console.log('content.js: Received "getTranscriptContent" message (already initialized) for ID:', request.transcriptId);
            const transcriptId = request.transcriptId;
            if (transcriptId >= 0 && transcriptId < collectedTranscripts.length) {
                const transcript = collectedTranscripts[transcriptId];
                chrome.runtime.sendMessage({
                    action: "transcriptContent",
                    transcriptId: transcriptId,
                    title: transcript.title,
                    content: transcript.content
                });
                console.log('content.js: Sent transcript content (already initialized) for ID:', transcriptId, 'Length:', transcript.content.length);
            } else {
                console.error('content.js: Invalid transcript ID requested (already initialized):', transcriptId);
                chrome.runtime.sendMessage({
                    action: "transcriptContentError",
                    transcriptId: transcriptId,
                    error: "Invalid transcript ID"
                });
            }
        } else if (request.action === "downloadAllTranscripts") { // Download handler for re-initialized script
            console.log('content.js: ============ DOWNLOAD ALL TRANSCRIPTS HANDLER (REINITIALIZED) ============');
            console.log('content.js: Received "downloadAllTranscripts" message in reinitialized script');
            console.log('content.js: Full request object:', request);
            console.log('content.js: Save prefix:', request.savePrefix);
            console.log('content.js: Test message:', request.testMessage);
            console.log('content.js: Number of transcripts to download:', collectedTranscripts.length);
            
            if (collectedTranscripts.length === 0) {
                console.error('content.js: No transcripts available for download (reinitialized)');
                sendResponse({ 
                    success: false, 
                    error: "No transcripts available for download",
                    transcriptCount: 0,
                    reinitialized: true
                });
                return true;
            }
            
            // Helper function to sanitize filename
            function sanitizeFilename(title) {
                return title.replace(/[/\\?%*:|"<>]/g, '_')
                           .replace(/\s+/g, '_')
                           .toLowerCase();
            }
            
            // Download each transcript
            for (let i = 0; i < collectedTranscripts.length; i++) {
                const transcript = collectedTranscripts[i];
                const filename = request.savePrefix + sanitizeFilename(transcript.title) + '.txt';
                
                console.log(`content.js: Downloading transcript ${i + 1}/${collectedTranscripts.length}: ${transcript.title} (reinitialized)`);
                console.log(`content.js: Filename: ${filename}, Content length: ${transcript.content.length}`);
                
                try {
                    // Create blob and download link
                    const blob = new Blob([transcript.content], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    
                    // Create temporary download link
                    const downloadLink = document.createElement('a');
                    downloadLink.href = url;
                    downloadLink.download = filename;
                    downloadLink.style.display = 'none';
                    
                    // Add to DOM, click, and remove
                    document.body.appendChild(downloadLink);
                    downloadLink.click();
                    document.body.removeChild(downloadLink);
                    
                    // Clean up blob URL after a delay
                    setTimeout(() => {
                        URL.revokeObjectURL(url);
                    }, 1000);
                    
                    console.log(`content.js: Download initiated for ${filename} (reinitialized)`);
                    
                    // Small delay between downloads
                    if (i < collectedTranscripts.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                    
                } catch (error) {
                    console.error(`content.js: Error downloading ${filename} (reinitialized):`, error);
                }
            }
            
            console.log('content.js: All downloads initiated from reinitialized content script');
            sendResponse({ 
                success: true, 
                downloadCount: collectedTranscripts.length,
                reinitialized: true,
                message: "All downloads initiated successfully from reinitialized script"
            });
            return true; // Keep message channel open
        }
    });
}

// Listen for logToPageConsole messages from popup.js and log to the main page's console
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'logToPageConsole' && request.message) {
        console.log('[Gemini Extension]', request.message);
    }
});
