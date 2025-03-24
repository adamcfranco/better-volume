/**
 * Better Volume - Popup Script
 * 
 * This script handles the popup UI and sends volume change commands
 * to the background script, which acts as the single source of truth.
 */

let container, notAvailable, available, settings, sliderValue, slider, settingsButton, closeSettingsButton, settingsTable, settingsTbody, settingsNoVolumes;
const sendVolumeChange_debounced = debounce(sendVolumeChange, 100);
let activeTabId = null;

// Initialize when the document is ready
document.addEventListener('DOMContentLoaded', () => {
	container = document.getElementById("slider-container");
	notAvailable = document.getElementById("view-not-available");
	available = document.getElementById("view-available");
	settings = document.getElementById("view-settings");
	sliderValue = document.getElementById("slider-value");
	slider = document.getElementById("slider");
	settingsButton = document.getElementById("settings-button");
	closeSettingsButton = document.getElementById("close-settings-button");
	settingsTable = document.getElementById("saved-volumes");
	settingsTbody = settingsTable?.querySelector("tbody");
	settingsNoVolumes = document.getElementById("no-volumes");
	initialize();
});

async function initialize() {
	console.log("[Better Volume] Initializing popup");
	try {
		// Get current active tab
		const tabs = await browser.tabs.query({ active: true, currentWindow: true });
		if (!tabs || !tabs.length) {
			showNotAvailable();
			console.warn("[Better Volume] No active tab found");
			return;
		}
		
		activeTabId = tabs[0].id;
		
		// Check if volume control is available for this tab
		const response = await browser.runtime.sendMessage({
			command: "get_volume",
			tabId: activeTabId
		});
		
		if (!response || !response.available) {
			showNotAvailable();
			console.warn("[Better Volume] Volume control not available for this tab");
			return;
		}

		// Update slider and text
		sliderValue.innerText = `${response.volume || 100}%`;
		slider.value = percentToStep(response.volume || 100);
		
		// Show UI and set current volume
		showAvailable();
		
		// Set up slider events for this tab
		slider.addEventListener('input', (e) => {
			const volume = stepToPercent(e.target.value);
			sliderValue.innerText = `${volume}%`;
		});
		
		slider.addEventListener('change', (e) => {
			sendVolumeChange_debounced(activeTabId, stepToPercent(e.target.value));
		});
		
		// Also update on input to be more responsive, but debounced
		slider.addEventListener('input', (e) => {
			sendVolumeChange_debounced(activeTabId, stepToPercent(e.target.value));
		});

		// Settings buttons
		settingsButton.addEventListener("click", () => {
			showSettings();
		});
		closeSettingsButton.addEventListener("click", () => {
			showAvailable();
		});
	} catch (err) {
		console.error("[Better Volume] Error initializing popup:", err);
		showNotAvailable();
	}
}
// Show the volume control UI
function showAvailable() {
	notAvailable.classList.add("hidden");
	available.classList.remove("hidden");
	settings.classList.add("hidden");
}

function showSettings() {
	notAvailable.classList.add("hidden");
	available.classList.add("hidden");
	settings.classList.remove("hidden");
	populateSettingsTable();
}

// Show the "not available" message
function showNotAvailable() {
	notAvailable.classList.remove("hidden");
	available.classList.add("hidden");
	settings.classList.add("hidden");
}

// Send volume change to background script
async function sendVolumeChange(tabId, volume) {
	try {
		await browser.runtime.sendMessage({
			command: "set_volume",
			tabId: tabId,
			volume: volume
		});
	} catch (err) {
		console.error("[Better Volume] Error sending volume change:", err);
	}
}

// Convert between slider steps and percentage
function stepToPercent(raw) {
	if (raw > 10) {
		return (raw - 9) * 10;
	}
	return raw;
}

function percentToStep(percent) {
	if (percent > 10) {
		return percent / 10 + 9;
	}
	return percent;
}

// Utility function to debounce function calls
function debounce(func, delay) {
	let timeout;
	return function (...args) {
		const context = this;
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			func.apply(context, args);
		}, delay);
	};
}

async function populateSettingsTable() {
	const volumes = await browser.storage.local.get('domainVolumes');
	volumes.domains = volumes.domainVolumes || {};
	settingsTbody.innerHTML = "";

	if (Object.keys(volumes.domains).length === 0) {
		settingsNoVolumes.classList.remove("hidden");
		settingsTable.classList.add("hidden");
	} else {
		settingsNoVolumes.classList.add("hidden");
		settingsTable.classList.remove("hidden");
	}

	for (const domain in volumes.domains) {
		const row = document.createElement("tr");

		const deleteCell = document.createElement("td");
		const deleteButton = document.createElement("button");
		deleteButton.title = "Delete this volume";
		deleteButton.innerText = "🗑️";
		deleteButton.addEventListener("click", () => {
			deleteVolume(domain);
		});

		const domainCell = document.createElement("td");
		domainCell.innerText = domain;

		const volumeCell = document.createElement("td");
		volumeCell.innerText = volumes.domains[domain] + "%";

		deleteCell.appendChild(deleteButton);
		row.appendChild(deleteCell);
		row.appendChild(domainCell);
		row.appendChild(volumeCell);
		
		settingsTbody.appendChild(row);
	}
}

async function deleteVolume(domain) {
	const response = await browser.runtime.sendMessage({
		command: "delete_volume",
		domain: domain,
		tabId: activeTabId
	});
	sliderValue.innerText = `${response.volume || 100}%`;
	slider.value = percentToStep(response.volume || 100);
	populateSettingsTable();
}