/**
 * Better Volume - Injectable Content Script
 * 
 * This script handles only page-level volume application:
 * 1. Early interception of AudioContext creation
 * 2. Management of media element volumes
 * 3. Applying volume changes from background script
 */

// Track processed media elements to avoid duplicate processing
const processedElements = new WeakSet();

// Create a shared AudioContext for managing gain nodes
let sharedContext;
try {
    sharedContext = new AudioContext();
} catch (e) {
    console.warn("[Better Volume] Failed to create AudioContext:", e);
}

// Inject script to intercept native AudioContext before any page scripts run
function injectEarlyInterceptor() {
    const script = document.createElement('script');
    script.textContent = `
        (function() {
            // Store original constructors
            const originalAudioContext = window.AudioContext;
            const originalWebkitAudioContext = window.webkitAudioContext;

            // Keep track of contexts and their gain nodes
            window.betterVolumeContexts = new Set();
            window.bvol_current = 1; // 100% volume by default

            // Function to wrap an AudioContext
            function wrapAudioContext(context) {
                try {
                    const masterGain = context.createGain();
                    const originalDestination = context.destination;

                    // Set initial volume
                    masterGain.gain.value = window.bvol_current;
                    
                    // Connect master gain to the real destination
                    masterGain.connect(originalDestination);

                    // Override the destination property
                    Object.defineProperty(context, 'destination', {
                        get: function() {
                            return masterGain;
                        },
                        configurable: true
                    });

                    // Store the gain node
                    window.betterVolumeContexts.add(masterGain);

                    return context;
                } catch (e) {
                    console.error("[Better Volume] Error wrapping context:", e);
                    return context;
                }
            }

            // Replace AudioContext
            window.AudioContext = function() {
                try {
                    const context = new originalAudioContext(...arguments);
                    return wrapAudioContext(context);
                } catch (e) {
                    console.error("[Better Volume] Error creating AudioContext:", e);
                    return new originalAudioContext(...arguments);
                }
            };
            window.AudioContext.prototype = originalAudioContext.prototype;

            // Replace webkitAudioContext if it exists
            if (originalWebkitAudioContext) {
                window.webkitAudioContext = function() {
                    const context = new originalWebkitAudioContext(...arguments);
                    return wrapAudioContext(context);
                };
                window.webkitAudioContext.prototype = originalWebkitAudioContext.prototype;
            }

            // Listen for volume change messages
            window.addEventListener('message', function(event) {
                if (event.data && event.data.type === 'bettervolume_setvolume') {
                    const volume = event.data.volume / 100;
                    window.bvol_current = volume;
                    
                    window.betterVolumeContexts.forEach(gainNode => {
                        try {
                            gainNode.gain.setValueAtTime(volume, gainNode.context.currentTime);
                        } catch (e) {
                            console.error("[Better Volume] Error setting gain:", e);
                        }
                    });
                }
            });
        })();
    `;

    // Insert the script at the very beginning of the document
    const parent = document.head || document.documentElement;
    parent.insertBefore(script, parent.firstChild);
    script.remove();
}

// Create gain node for media elements
function applyGainToElement(element) {
    if (!element || processedElements.has(element))
        return;

    try {
        if (!sharedContext) {
            sharedContext = new AudioContext();
        }

        const gainNode = sharedContext.createGain();
        const source = sharedContext.createMediaElementSource(element);

        source.connect(gainNode);
        gainNode.connect(sharedContext.destination);

        // Set initial volume from global currentVolume
        gainNode.gain.value = currentVolume / 100;

        // Store gain control on the element
        element.betterVolumeGain = gainNode;

        // Mark as processed
        processedElements.add(element);

        return true;
    } catch (e) {
        console.warn("[Better Volume] Error applying gain to element:", e);
        return false;
    }
}

// Apply volume to all media elements
function updateAllElements(volume) {
    const gainValue = volume / 100;

    // Process audio/video elements in the main document
    document.querySelectorAll('audio, video').forEach(element => {
        if (!processedElements.has(element)) {
            applyGainToElement(element);
        } else if (element.betterVolumeGain) {
            element.betterVolumeGain.gain.value = gainValue;
        }
    });

    // Try to process elements in accessible iframes
    try {
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                if (iframe.contentDocument) {
                    iframe.contentDocument.querySelectorAll('audio, video').forEach(element => {
                        if (!processedElements.has(element)) {
                            applyGainToElement(element);
                        } else if (element.betterVolumeGain) {
                            element.betterVolumeGain.gain.value = gainValue;
                        }
                    });
                }
            } catch (e) {
                // Ignore cross-origin iframe errors
            }
        });
    } catch (e) {
        console.warn("[Better Volume] Error processing iframes:", e);
    }

    // Update page-level audio contexts
    window.postMessage({
        type: 'bettervolume_setvolume',
        volume: volume
    }, '*');
}

// Create a simple observer to watch for new media elements
function setupMediaElementObserver() {
    // Create a more efficient mutation observer
    const observer = new MutationObserver((mutations) => {
        let hasNewMedia = false;

        // Quickly check for media elements in the mutations
        for (const mutation of mutations) {
            if (mutation.type !== 'childList' || !mutation.addedNodes.length) continue;

            for (const node of mutation.addedNodes) {
                // Check if the node itself is a media element
                if (node.nodeName === 'VIDEO' || node.nodeName === 'AUDIO') {
                    hasNewMedia = true;
                    break;
                }

                // Check for media elements within added nodes
                if (node.querySelectorAll) {
                    const mediaElements = node.querySelectorAll('video, audio');
                    if (mediaElements.length > 0) {
                        hasNewMedia = true;
                        break;
                    }
                }
            }

            if (hasNewMedia) break;
        }

        // Only process all elements if we found new media
        if (hasNewMedia) {
            updateAllElements(currentVolume);
        }
    });

    // Start observing document
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // Also set up a periodic check for new elements (some sites load elements dynamically)
    const periodicCheck = setInterval(() => {
        const mediaElements = document.querySelectorAll('audio, video');
        let hasUnprocessed = false;

        for (const element of mediaElements) {
            if (!processedElements.has(element)) {
                hasUnprocessed = true;
                break;
            }
        }

        if (hasUnprocessed) {
            updateAllElements(currentVolume);
        }
    }, 3000);

    return { observer, periodicCheck };
}

// Extract domain from URL
function getDomainFromUrl(url) {
    try {
        const hostname = new URL(url).hostname;
        return hostname.replace(/^www\./, '');
    } catch (e) {
        return null;
    }
}

// Track current volume
let currentVolume = 100;

// Handle messages from background script
browser.runtime.onMessage.addListener((message) => {
    // Apply volume from background
    if (message.command === "apply_volume") {
        currentVolume = message.volume;
        updateAllElements(currentVolume);
        return Promise.resolve({ success: true });
    }

    // Check if volume control is available
    if (message.command === "check_availability") {
        // 2. This script is injected successfully
        const domain = getDomainFromUrl(window.location.href);
        return Promise.resolve({ available: domain !== null });
    }

    return false;
});

// Initialize the content script
(function init() {
    // Only initialize once
    if (window.betterVolumeInitialized) return;
    window.betterVolumeInitialized = true;

    // Inject early interceptor first
    injectEarlyInterceptor();

    // Set up observers
    setupMediaElementObserver();

    // Report that we're ready to the background script
    browser.runtime.sendMessage({ command: "content_script_ready" })
        .catch(() => {
            // Ignore errors, background script might not be ready yet
        });

    // Process any existing elements with default volume
    updateAllElements(currentVolume);
})();