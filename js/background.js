/**
 * Better Volume - Background Script (Single Source of Truth)
 * 
 * This script handles:
 * 1. Storage of domain volume settings
 * 2. Management of all volume change events
 * 3. Propagation of volume settings to tabs of the same domain
 * 4. Badge display of current volume
 */

// Store volume for active tabs and domains
const volumes = {
	tabs: {},        // Tab ID -> volume
	domains: {}      // Domain -> volume
};

// Load saved domain volumes on startup
browser.storage.local.get('domainVolumes')
	.then(result => {
		volumes.domains = result.domainVolumes || {};
		console.log('[Better Volume] Loaded domain volumes:', Object.keys(volumes.domains).length);
	})
	.catch(err => console.error('[Better Volume] Error loading domain volumes:', err));

// Extract domain from URL
function getDomainFromUrl(url) {
	try {
		const hostname = new URL(url).hostname;
		return hostname.replace(/^www\./, '');
	} catch (e) {
		return null;
	}
}

// Update badge text for the active tab
function updateBadgeText(tabId, volume) {
	browser.browserAction.setBadgeText({
		text: volume != null ? `${volume}` : "",
		tabId: tabId
	});
}

// Set tab volume and propagate to domain if needed
function setTabVolume(tabId, volume, options = {}) {
	// Default options
	const opts = {
		propagateToDomain: true,
		updateTab: true,
		...options
	};

	// Store in our tabs object
	volumes.tabs[tabId] = volume;

	// Update badge text
	updateBadgeText(tabId, volume);

	// Apply volume to the tab if needed
	if (opts.updateTab) {
		browser.tabs.sendMessage(tabId, {
			command: "apply_volume",
			volume: volume
		}).catch(() => {
			// Tab might not have content script loaded, which is expected
		});
	}

	// Get tab info to propagate to domain if needed
	if (opts.propagateToDomain) {
		browser.tabs.get(tabId)
			.then(tab => {
				if (tab.url) {
					const domain = getDomainFromUrl(tab.url);
					if (domain) {
						propagateVolumeToDomain(domain, volume, tabId);
					}
				}
			})
			.catch(err => {
				console.error('[Better Volume] Error getting tab info:', err);
			});
	}
}

// Propagate volume to tabs with the same domain
function propagateVolumeToDomain(domain, volume, sourceTabId, deleteVolume = false) {
	if (!domain) return;

	// Store in domains object
	volumes.domains[domain] = volume;

	// Save to storage
	if (!deleteVolume) {
		browser.storage.local.set({ domainVolumes: volumes.domains })
			.catch(err => console.error('[Better Volume] Error saving domain volumes:', err));
	}

	// Find all tabs with the same domain and update them
	browser.tabs.query({})
		.then(tabs => {
			// Batch updates to avoid overwhelming the browser
			const sameDomainTabs = tabs.filter(tab => {
				if (!tab.url) return false;
				if (tab.id === sourceTabId) return false; // Skip source tab

				return getDomainFromUrl(tab.url) === domain;
			});

			if (sameDomainTabs.length === 0) return;

			console.log(`[Better Volume] Updating ${sameDomainTabs.length} tabs with domain ${domain}`);

			// Process tabs in small batches
			const batchSize = 3;
			let currentBatch = 0;

			function processBatch() {
				const startIdx = currentBatch * batchSize;
				const endIdx = Math.min(startIdx + batchSize, sameDomainTabs.length);
				const currentTabs = sameDomainTabs.slice(startIdx, endIdx);

				currentTabs.forEach(tab => {
					// Set volume for this tab but don't re-propagate to domain
					setTabVolume(tab.id, volume, { propagateToDomain: false });
				});

				// Process next batch if needed
				currentBatch++;
				if (currentBatch * batchSize < sameDomainTabs.length) {
					setTimeout(processBatch, 100);
				}
			}

			processBatch();
		})
		.catch(err => console.error('[Better Volume] Error querying tabs:', err));
}

// Get the volume for a tab, defaulting to domain volume if available
function getVolumeForTab(tabId, url) {
	// Check tab-specific volume first
	if (volumes.tabs[tabId] !== undefined) {
		return volumes.tabs[tabId];
	}

	// Check domain volume if we have a URL
	if (url) {
		const domain = getDomainFromUrl(url);
		if (domain && volumes.domains[domain] !== undefined) {
			// Store for next time
			volumes.tabs[tabId] = volumes.domains[domain];
			return volumes.domains[domain];
		}
	}

	// Default to 100%
	return 100;
}

// Check if volume control is available for a tab
async function isVolumeControlAvailable(tabId) {
	try {
		const response = await browser.tabs.sendMessage(tabId, { command: "check_availability" });
		return response && response.available === true;
	} catch (error) {
		return false;
	}
}

// Remove domain volume and clear all tab settings for that domain
function resetDomainVolume(domain) {
	// Remove the domain from storage
	delete volumes.domains[domain];
	browser.storage.local.set({ domainVolumes: volumes.domains });
	
	// Find all tabs with this domain and clear their volume settings
	return browser.tabs.query({})
		.then(tabs => {
			const affectedTabs = tabs.filter(tab => {
				if (!tab.url) return false;
				return getDomainFromUrl(tab.url) === domain;
			});
			
			// Process each affected tab
			affectedTabs.forEach(tab => {
				// Reset volume to 100%
				browser.tabs.sendMessage(tab.id, {
					command: "apply_volume",
					volume: 100
				}).catch(() => {/* Expected for some tabs */});
				
				// Clear badge and tracking
				browser.browserAction.setBadgeText({
					text: "",
					tabId: tab.id
				});
				delete volumes.tabs[tab.id];
			});
			
			console.log(`[Better Volume] Reset ${affectedTabs.length} tabs for domain ${domain}`);
		})
		.catch(err => console.error('[Better Volume] Error finding tabs for domain:', err));
}

// Handle messages from popup and content scripts
browser.runtime.onMessage.addListener((message, sender) => {
	// Content script reporting it's ready
	if (message.command === "content_script_ready") {
		const tabId = sender.tab?.id;
		if (!tabId) return Promise.resolve();

		// Get volume for this tab and apply it immediately
		const url = sender.tab.url;
		const volume = getVolumeForTab(tabId, url);

		// Set tab volume but don't propagate to domain (avoid circular updates)
		setTabVolume(tabId, volume, { propagateToDomain: false });

		return Promise.resolve();
	}

	// Set volume from popup
	if (message.command === "set_volume") {
		const tabId = message.tabId;
		const volume = message.volume;

		if (!tabId) return Promise.resolve({ success: false, error: "No tab specified" });

		// Set tab volume and propagate to domain
		setTabVolume(tabId, volume);

		return Promise.resolve({ success: true });
	}

	// Get volume for popup
	if (message.command === "get_volume") {
		const tabId = message.tabId;
		if (!tabId) return Promise.resolve({ volume: null, available: false });

		// Check if volume control is available
		return isVolumeControlAvailable(tabId)
			.then(available => {
				if (!available) {
					return { volume: null, available: false };
				}

				// Get tab info to check domain if needed
				return browser.tabs.get(tabId)
					.then(tab => {
						const volume = getVolumeForTab(tabId, tab.url);
						return { volume, available: true };
					});
			})
			.catch(err => {
				console.error('[Better Volume] Error checking volume availability:', err);
				return { volume: null, available: false };
			});
	}

	if (message.command === "delete_volume") {
		return resetDomainVolume(message.domain)
		.then(() => {
			const volume = getVolumeForTab(message.tabId, message.domain);
			return Promise.resolve({ volume });
		});
	}

	return false;
});

// Update badge when a tab is activated
browser.tabs.onActivated.addListener(({ tabId }) => {
	const volume = volumes.tabs[tabId];
	updateBadgeText(tabId, volume);
});

// Remove tab from tracking when closed
browser.tabs.onRemoved.addListener((tabId) => {
	delete volumes.tabs[tabId];
});

// Initialize newly loaded tabs
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status !== 'complete' || !tab.url) return;

	const domain = getDomainFromUrl(tab.url);
	if (!domain) return;

	// Check if we have a domain volume for this tab
	const domainVolume = volumes.domains[domain];
	if (domainVolume !== undefined) {
		// Set tab volume but don't propagate to domain (avoid circular updates)
		setTabVolume(tabId, domainVolume, { propagateToDomain: false });
	}
});

// Set badge background color
browser.browserAction.setBadgeBackgroundColor({ color: `rgb(0, 100, 255)` });
