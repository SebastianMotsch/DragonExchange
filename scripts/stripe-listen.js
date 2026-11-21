// Use this project's test key without putting secrets in command arguments/logs.
require("dotenv").config({ quiet: true });
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function start() {
  if (!/^sk_test_/.test(process.env.STRIPE_SECRET_KEY || "")) {
    console.error("Set STRIPE_SECRET_KEY to a test secret in the project's .env.");
    process.exitCode = 1;
    return;
  }
  let executable = process.env.STRIPE_CLI_PATH || "stripe";
  const packages = path.join(process.env.LOCALAPPDATA || "", "Microsoft/WinGet/Packages");
  if (!process.env.STRIPE_CLI_PATH && fs.existsSync(packages)) {
    const installed = fs.readdirSync(packages).find(name => name.startsWith("Stripe.StripeCli_"));
    if (installed && fs.existsSync(path.join(packages, installed, "stripe.exe"))) {
      executable = path.join(packages, installed, "stripe.exe");
    }
  }
  const envFile = path.join(__dirname, "../.env");
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT must be a valid port number.");
    process.exitCode = 1;
    return;
  }
  const child = spawn(executable, [
    "listen", "--skip-update",
    "--events", "checkout.session.completed,checkout.session.async_payment_succeeded",
    "--forward-to", "http://127.0.0.1:" + port + "/api/wallet/webhook",
  ], {
    env: { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  function read(stream) {
    let buffer = "";
    stream.on("data", chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const secret = line.match(/whsec_[A-Za-z0-9]+/);
        if (secret && !ready) {
          const text = fs.readFileSync(envFile, "utf8");
          const assignment = "STRIPE_WEBHOOK_SECRET=" + secret[0];
          const updated = /^\s*STRIPE_WEBHOOK_SECRET\s*=.*$/m.test(text)
            ? text.replace(/^\s*STRIPE_WEBHOOK_SECRET\s*=.*$/m, assignment)
            : text.trimEnd() + "\n" + assignment + "\n";
          fs.writeFileSync(envFile, updated, { mode: 0o600 });
          ready = true;
          console.log("Stripe test listener ready. Signing secret saved to .env (not displayed).");
          console.log("Keep this command running. Restart npm start to load the secret.");
        } else if (/\[\d{3}\]/.test(line)) {
          console.log("Webhook forwarded: HTTP " + line.match(/\[(\d{3})\]/)[1]);
        } else if (/error|failed/i.test(line)) {
          console.error("Stripe CLI reported an error; check the key, connection, and app.");
        }
      }
    });
  }
  read(child.stdout);
  read(child.stderr);
  child.on("error", error => {
    console.error("Unable to start Stripe CLI:", error.code || error.name);
    process.exitCode = 1;
  });
  child.on("exit", code => {
    if (!ready) console.error("Stripe listener exited before a signing secret was received.");
    process.exitCode = code || 0;
  });
  process.on("SIGINT", () => child.kill());
  process.on("SIGTERM", () => child.kill());
}
start();
