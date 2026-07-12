const screenTitles = {
  dashboard: "Homeowner Dashboard",
  post: "Post a Job",
  bids: "Compare Bids",
  handyman: "Handyman Dashboard",
  messages: "Messages",
};

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active", screen.id === screenId);
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.screen === screenId);
  });

  document.querySelector("#screen-title").textContent = screenTitles[screenId] || "FixMyHome Mockup";
  window.location.hash = screenId;
}

document.querySelectorAll("[data-screen]").forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.screen));
});

document.querySelectorAll("[data-screen-target]").forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.screenTarget));
});

const initialScreen = window.location.hash.replace("#", "");
if (screenTitles[initialScreen]) {
  showScreen(initialScreen);
}
