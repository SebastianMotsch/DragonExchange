const headerLoginLink = document.querySelector('header nav a[href$="login.html"]');

if (headerLoginLink) {
  const signOutButton = document.createElement("button");
  signOutButton.type = "button";
  signOutButton.textContent = "Sign out";

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try {
      const response = await fetch("/auth/logout", {
        method: "POST",
        headers: { "X-Requested-With": "DragonExchange" }
      });
      if (!response.ok) throw new Error();
      window.location.replace("/auth/login.html");
    } catch {
      signOutButton.textContent = "Retry sign out";
      signOutButton.disabled = false;
    }
  });

  async function refreshSessionNavigation() {
    try {
      const response = await fetch("/auth/me", { cache: "no-store" });
      if (response.ok) {
        if (headerLoginLink.getAttribute("aria-current") === "page") {
          window.location.replace("/account/dashboard.html");
        } else {
          headerLoginLink.replaceWith(signOutButton);
        }
      } else if (response.status === 401) {
        signOutButton.replaceWith(headerLoginLink);
      }
    } catch {
      // Keep the current navigation.
    }
  }

  refreshSessionNavigation();
  window.addEventListener("pageshow", event => {
    if (event.persisted) refreshSessionNavigation();
  });
}
