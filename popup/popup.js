(() => {

	const container = document.getElementById("slider-container");
	const notAvailable = document.getElementById("not-available");
	const sliderValue = document.getElementById("slider-value");
	const slider = document.getElementById("slider");

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

	function updateVolume(step) {
		window.currentPercent = stepToPercent(step);
		sliderValue.innerText = `${window.currentPercent}%`;
		browser.tabs
			.query({ active: true, currentWindow: true })
			.then((tabs) => {
				browser.tabs.sendMessage(
					tabs[0].id,
					{
						command: "bettervolume_set",
						volume: Number(window.currentPercent),
						tabId: tabs[0].id
					},
					(response) => {}
				);
			})
			.catch((err) => console.error(err));
	}

	function initialize() {
		notAvailable.classList.add("hidden");
		container.classList.remove("hidden");
		slider.oninput = (e) => updateVolume(e.target.value);
		browser.tabs
			.query({ active: true, currentWindow: true })
			.then((tabs) => {
				browser.tabs.sendMessage(
					tabs[0].id,
					{
						command: "bettervolume_get",
						tabId: tabs[0].id
					},
					(response) => {
						window.currentPercent = response.volume;
						sliderValue.innerText = `${window.currentPercent}%`;
						slider.setAttribute(
							"value",
							percentToStep(window.currentPercent)
						);
					}
				);
			})
			.catch((err) => console.error(err));
	}

	browser.tabs
		.executeScript({ file: "/js/bettervolume.js" })
		.then(initialize)
		.catch((error) => console.error(error));
})();
