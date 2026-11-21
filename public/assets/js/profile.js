// Profile page for issue #12: shows the logged-in student's real account details
// and lets them change their display name. The email can't be edited here.
const profileStatus = document.querySelector("#profile-status");
const profileLogin = document.querySelector("#profile-login");
const profileDetails = document.querySelector("#profile-details");
const nameForm = document.querySelector("#name-form");
const nameInput = document.querySelector("#name-input");
const nameMessage = document.querySelector("#name-message");

function showProfile(profile) {
  document.querySelector("#profile-name").textContent = profile.name || "No display name yet";
  document.querySelector("#profile-email").textContent = profile.email;
  document.querySelector("#profile-verified").textContent = profile.verified
    ? "Verified"
    : "Not verified yet. Verify your Drexel email before buying, selling, or bidding.";
  document.querySelector("#profile-joined").textContent =
    new Date(profile.created_at).toLocaleDateString([], { dateStyle: "long" });
  nameInput.value = profile.name || "";
}

async function loadProfile() {
  try {
    const response = await fetch("/api/account/profile", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) {
      profileStatus.textContent = "Log in to see your profile.";
      profileLogin.hidden = false;
      return;
    }
    if (!response.ok) throw new Error("Request failed");
    const data = await response.json();
    showProfile(data.profile);
    profileStatus.textContent = "";
    profileDetails.hidden = false;
  } catch {
    profileStatus.textContent = "Could not load your profile. Refresh the page to try again.";
  }
}

nameForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (name === "") {
    nameMessage.textContent = "Enter a display name.";
    nameInput.setAttribute("aria-invalid", "true");
    return;
  }
  nameInput.removeAttribute("aria-invalid");
  const button = nameForm.querySelector("button");
  button.disabled = true;
  nameMessage.textContent = "Saving…";
  try {
    const response = await fetch("/api/account/profile", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "DragonExchange" },
      body: JSON.stringify({ name: name }),
    });
    const data = await response.json();
    if (!response.ok) {
      nameMessage.textContent = data.error || "Could not save your name.";
      return;
    }
    showProfile(data.profile);
    nameMessage.textContent = "Display name saved.";
  } catch {
    nameMessage.textContent = "Could not save your name. Check your connection and try again.";
  } finally {
    button.disabled = false;
  }
});

loadProfile();
