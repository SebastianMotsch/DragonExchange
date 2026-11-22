const loginForm = document.getElementById("login-form");
const loginButton = loginForm.querySelector('button[type="submit"]');
const loginStatus = loginForm.querySelector(".status");

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (loginButton.disabled) return;

  loginButton.disabled = true;
  loginStatus.textContent = "Logging in…";
  try {
    const response = await fetch(loginForm.action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(loginForm)))
    });
    if (!response.ok) {
      const { error } = await response.json();
      loginStatus.textContent = error || "Login failed. Please try again.";
      return;
    }

    const next = new URLSearchParams(window.location.search).get("next");
    const origin = window.location.origin;
    if (next?.startsWith("/") && URL.canParse(next, origin)) {
      const destination = new URL(next, origin);
      if (destination.origin === origin) {
        window.location.assign(destination.href);
        return;
      }
    }
    window.location.assign("/account/dashboard.html");
  } catch {
    loginStatus.textContent = "Login is temporarily unavailable. Please try again.";
  } finally {
    loginButton.disabled = false;
  }
});
