const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const formScript = readFileSync(join(__dirname, "../public/assets/js/register.js"), "utf8");

// Run the actual browser script with just the DOM methods used by this form.
function loadForm(status = 201, responseBody = { message: "Account created." }) {
  const elements = {};
  const requests = [];
  let focused;
  const elementIds = [
    "register-form", "register-name", "register-email", "register-password",
    "name-error", "email-error", "password-error", "register-status", "register-submit"
  ];

  for (const id of elementIds) {
    elements[id] = {
      value: "",
      textContent: "",
      disabled: false,
      validity: {},
      attributes: {},
      listeners: {},
      setAttribute: function (name, value) {
        this.attributes[name] = value;
      },
      addEventListener: function (name, listener) {
        this.listeners[name] = listener;
      },
      focus: function () {
        focused = id;
      }
    };
  }
  elements["register-name"].value = "Example Student";
  elements["register-email"].value = "student@drexel.edu";
  runInNewContext(formScript, {
    document: {
      getElementById: function (id) {
        return elements[id];
      }
    },
    TextEncoder: TextEncoder,
    AbortSignal: AbortSignal,
    fetch: async function (url, options) {
      requests.push({
        url: url,
        body: JSON.parse(options.body)
      });
      return {
        ok: status >= 200 && status < 300,
        status: status,
        json: async function () {
          if (responseBody === null) {
            throw new SyntaxError("Not JSON");
          }
          return responseBody;
        }
      };
    }
  });
  return {
    elements: elements,
    requests: requests,
    focused: function () {
      return focused;
    },
    submit: function () {
      const event = {
        preventDefault: function () {}
      };
      return elements["register-form"].listeners.submit(event);
    }
  };
}

const oversizedPasswords = [
  "A1!" + "a".repeat(70),
  "A1!" + "é".repeat(35),
  "A1!" + "😀".repeat(18)
];

for (const password of oversizedPasswords) {
  test("long password gets understandable feedback before any request: " + password.length + " characters", async function () {
    const form = loadForm();
    const input = form.elements["register-password"];
    input.value = password;
    input.listeners.input();
    assert.equal(form.elements["password-error"].textContent, "Your password is too long. Shorten it and try again.");
    await form.submit();
    assert.equal(form.requests.length, 0);
    assert.equal(input.value, password);
    assert.equal(input.attributes["aria-invalid"], "true");
    assert.equal(form.focused(), "register-password");

    input.value = "Example123!";
    input.listeners.input();
    assert.equal(form.elements["password-error"].textContent, "");
    assert.equal(input.attributes["aria-invalid"], "false");
    await form.submit();
    assert.equal(form.requests.length, 1);
    assert.equal(form.elements["register-status"].textContent, "Account created.");
  });
}

const allowedPasswords = [
  "A1!" + "a".repeat(69),
  "A1!" + "é".repeat(34) + "a",
  " A1!abcd"
];

for (const password of allowedPasswords) {
  test("submits an allowed password unchanged: " + password.length + " characters", async function () {
    const form = loadForm();
    form.elements["register-password"].value = password;
    await form.submit();
    assert.equal(form.requests.length, 1);
    assert.equal(form.requests[0].body.password, password);
    assert.equal(form.elements["register-password"].value, "");
  });
}

test("server password-length rejection focuses the password field with plain feedback", async function () {
  const form = loadForm(422, { code: "PASSWORD_TOO_LONG", error: "Internal detail" });
  form.elements["register-password"].value = "Example123!";
  await form.submit();
  assert.equal(form.elements["password-error"].textContent, "Your password is too long. Shorten it and try again.");
  assert.equal(form.focused(), "register-password");
  assert.equal(form.elements["register-submit"].disabled, false);
});

const errorCases = [
  {
    description: "too many attempts with one email",
    status: 429,
    body: {},
    expected: "Too many attempts with this email. Please wait 15 minutes before trying again."
  },
  {
    description: "server at registration capacity",
    status: 503,
    body: { code: "REGISTRATION_BUSY" },
    expected: "Registration is busy right now. Please wait a moment and try again."
  },
  {
    description: "invalid registration input",
    status: 422,
    body: { error: "Internal detail" },
    expected: "Check your name, Drexel email, and password requirements."
  },
  {
    description: "server error without JSON",
    status: 503,
    body: null,
    expected: "Registration is temporarily unavailable. If you already submitted, try logging in before registering again."
  }
];

for (const errorCase of errorCases) {
  test("shows safe registration feedback for " + errorCase.description, async function () {
    const form = loadForm(errorCase.status, errorCase.body);
    form.elements["register-password"].value = "Example123!";
    await form.submit();
    assert.equal(form.elements["register-status"].textContent, errorCase.expected);
    assert.equal(form.elements["register-password"].value, "Example123!");
    assert.equal(form.elements["register-submit"].disabled, false);
  });
}
