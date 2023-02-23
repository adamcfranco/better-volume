window.bettervolumes = {};

browser.runtime.onMessage.addListener((data, sender) => {
	if (data.command !== "bettervolume_background") {
		return false;
	}
	window.bettervolumes[data.tabId] = data.volume;
	browser.browserAction.setBadgeText({
		text: `${data.volume}`,
	});
	return Promise.resolve();
});

browser.tabs.onActivated.addListener((activeInfo) => {
	const volume = window.bettervolumes[activeInfo.tabId];
	browser.browserAction.setBadgeText({
		text: volume != null ? `${volume}` : null,
	});
	return Promise.resolve();
});

browser.tabs.onRemoved.addListener((tabId) => {
	delete window.bettervolumes[tabId];
	return Promise.resolve();
});

browser.browserAction.setBadgeBackgroundColor({ color: `rgb(0, 100, 255)` });
