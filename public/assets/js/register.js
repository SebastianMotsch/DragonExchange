const registerForm = document.getElementById("register-form");
const nameInput = document.getElementById("register-name");
const emailInput = document.getElementById("register-email");
const passwordInput = document.getElementById("register-password");
const nameError = document.getElementById("name-error");
const emailError = document.getElementById("email-error");
const passwordError = document.getElementById("password-error");
const registerStatus = document.getElementById("register-status");
const registerButton = document.getElementById("register-submit");
const passwordTooLongMessage = "Your password is too long. Shorten it and try again.";
const maxPasswordBytes = 72;

registerForm.noValidate = true;
registerForm.addEventListener("submit", checkRegistration);
passwordInput.addEventListener("input", checkPasswordLength);

function isPasswordTooLong(password) {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  return passwordBytes.length > maxPasswordBytes;
}

function showPasswordTooLongError() {
  passwordError.textContent = passwordTooLongMessage;
  passwordInput.setAttribute("aria-invalid", "true");
}

function checkPasswordLength() {
  if (isPasswordTooLong(passwordInput.value)) {
    showPasswordTooLongError();
  } else if (passwordError.textContent === passwordTooLongMessage) {
    passwordError.textContent = "";
    passwordInput.setAttribute("aria-invalid", "false");
  }
}

async function checkRegistration(event) {
  event.preventDefault();

  if (registerButton.disabled) {
    return;
  }

  nameError.textContent = "";
  emailError.textContent = "";
  passwordError.textContent = "";
  registerStatus.textContent = "";
  nameInput.setAttribute("aria-invalid", "false");
  emailInput.setAttribute("aria-invalid", "false");
  passwordInput.setAttribute("aria-invalid", "false");

  const name = nameInput.value.trim();
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  nameInput.value = name;
  emailInput.value = email;
  let valid = true;

  if (name === "") {
    nameError.textContent = "Enter your display name.";
    nameInput.setAttribute("aria-invalid", "true");
    valid = false;
  }

  const emailIsMissing = email === "";
  const emailFormatIsInvalid = emailInput.validity.typeMismatch || emailInput.validity.patternMismatch;
  const emailIsNotDrexel = !email.endsWith("@drexel.edu");

  if (emailIsMissing || emailFormatIsInvalid || emailIsNotDrexel) {
    emailError.textContent = "Use a valid Drexel email with only letters and numbers before @drexel.edu.";
    emailInput.setAttribute("aria-invalid", "true");
    valid = false;
  }

  let hasUppercase = false;
  let hasNumber = false;
  let hasSpecial = false;
  const specialCharacters = "!@#$%^&*()-_=+[]{};:'\",.<>/?\\|`~";

  for (let i = 0; i < password.length; i++) {
    const character = password[i];

    if (character >= "A" && character <= "Z") {
      hasUppercase = true;
    }
    if (character >= "0" && character <= "9") {
      hasNumber = true;
    }
    if (specialCharacters.includes(character)) {
      hasSpecial = true;
    }
  }

  if (password.length < 8 || !hasUppercase || !hasNumber || !hasSpecial) {
    passwordError.textContent = "Use at least 8 characters, one uppercase letter, one number, and one special character.";
    passwordInput.setAttribute("aria-invalid", "true");
    valid = false;
  }

  if (isPasswordTooLong(password)) {
    showPasswordTooLongError();
    valid = false;
  }

  if (!valid) {
    if (nameError.textContent !== "") {
      nameInput.focus();
    } else if (emailError.textContent !== "") {
      emailInput.focus();
    } else {
      passwordInput.focus();
    }
    return;
  }

  registerButton.disabled = true;
  registerButton.textContent = "Creating account...";
  registerStatus.textContent = "Submitting your registration...";

  let requestSignal;
  try {
    requestSignal = AbortSignal.timeout(15000);
    const response = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name,
        email: email,
        password: password
      }),
      signal: requestSignal
    });

    if (!response.ok) {
      await showRegistrationError(response);
      return;
    }

    const result = await response.json();
    if (result && typeof result.message === "string" && result.message.trim() !== "") {
      registerStatus.textContent = result.message;
    } else {
      registerStatus.textContent = "Your account was created. Make sure to verify your Drexel email to complete registration.";
    }
    passwordInput.value = "";
  } catch {
    if (requestSignal && requestSignal.aborted) {
      registerStatus.textContent = "The request took too long. We couldn't confirm registration. Try logging in before registering again.";
    } else {
      registerStatus.textContent = "We couldn't confirm registration. Check your connection. If you already submitted, try logging in before registering again.";
    }
  } finally {
    registerButton.disabled = false;
    registerButton.textContent = "Create account";
  }
}

async function showRegistrationError(response) {
  let errorCode = "";

  try {
    const result = await response.json();
    if (result && typeof result.code === "string") {
      errorCode = result.code;
    }
  } catch {
  }

  // Choose a known message rather than displaying raw server errors.
  if (response.status === 409) {
    registerStatus.textContent = "We couldn't create an account with this email. If you are already registered, try logging in.";
    return;
  }

  if (response.status === 422 && errorCode === "PASSWORD_TOO_LONG") {
    showPasswordTooLongError();
    passwordInput.focus();
    registerStatus.textContent = "Check your password and try again.";
    return;
  }

  if (response.status === 400 || response.status === 422) {
    registerStatus.textContent = "Check your name, Drexel email, and password requirements.";
    return;
  }

  if (response.status === 429) {
    registerStatus.textContent = "Too many attempts with this email. Please wait 15 minutes before trying again.";
    return;
  }

  if (response.status === 503 && errorCode === "REGISTRATION_BUSY") {
    registerStatus.textContent = "Registration is busy right now. Please wait a moment and try again.";
    return;
  }

  if (response.status === 404 || response.status === 501) {
    registerStatus.textContent = "Registration is not available yet.";
    return;
  }

  registerStatus.textContent = "Registration is temporarily unavailable. If you already submitted, try logging in before registering again.";
}
