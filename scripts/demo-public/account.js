const loginForm = document.querySelector("#login-form");
if (loginForm)
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = loginForm.querySelector(".status"),
      button = loginForm.querySelector("button");
    button.disabled = true;
    status.textContent = "Logging in…";
    try {
      const fields = new FormData(loginForm);
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "DragonExchange",
        },
        body: JSON.stringify({
          email: fields.get("email"),
          password: fields.get("password"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const next = new URLSearchParams(location.search).get("next");
      const allowed = [
        "/auctions/create.html",
        "/account/dashboard.html",
        "/account/profile.html",
      ];
      location.assign(allowed.includes(next) ? next : "/index.html");
    } catch (error) {
      status.textContent = error.message || "Unable to log in.";
    } finally {
      button.disabled = false;
    }
  });
if (!loginForm) {
  const header = document.querySelector("header");
  if (header)
    (async () => {
      try {
        const response = await fetch("/auth/me");
        if (!response.ok) return;
        const { user } = await response.json();
        const bar = document.createElement("p");
        bar.textContent = "Signed in as " + user.name;
        header.append(bar);
      } catch {}
    })();
}
