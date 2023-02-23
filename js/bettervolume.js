(() => {
	if (window.initializedBetterVolume) {
		return;
	}

	function updateElements() {
		const volume = window.currVolume / 100;
		const elements = [...document.querySelectorAll("video, audio")];
		const iframes = [...document.querySelectorAll("iframe")];
		for (const iframe of iframes) {
			if (iframe.contentDocument) {
				const iframeElements = [...iframe.contentDocument.querySelectorAll("video, audio")];
				elements.push(...iframeElements);
			}
		}
		for (const element of elements) {
			if (element.bettervolume == null) {
				console.log("[Better Volume] Found new media element", element)
				element.bettervolume = gainContext(element);
			}
			element.bettervolume.gainNode.gain.value = volume;
		}
	}
	
	function gainContext(element) {
		const context = new AudioContext();
		const gainNode = context.createGain();
		const source = context.createMediaElementSource(element);
		source.connect(gainNode);
		gainNode.connect(context.destination);
		return { context, gainNode, source };
	}

	window.prevVolume = null;
	window.currVolume = 100;

	browser.runtime.onMessage.addListener((data, sender) => {
		if (data.command === "bettervolume_get") {
			return Promise.resolve({ volume: window.currVolume });
		} else if (data.command === "bettervolume_set") {
			window.currVolume = Number(data.volume);
			if (window.prevVolume === window.currVolume) {
				return Promise.resolve({ volume: window.currVolume });
			}
			window.prevVolume = window.currVolume;
			updateElements();
			browser.runtime
				.sendMessage({
					command: "bettervolume_background",
					volume: window.currVolume,
					tabId: data.tabId,
				})
				.catch((err) => console.error(err));
			return Promise.resolve({ volume: window.currVolume });
		}
		return false;
	});

	const observer = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			if (mutation.addedNodes.length > 0) {
				console.log("[Better Volume] Found added elements");
				updateElements();
			}
		});
	});
	observer.observe(document.body, { childList: true, subtree: true });

	window.initializedBetterVolume = Date.now();
})();
