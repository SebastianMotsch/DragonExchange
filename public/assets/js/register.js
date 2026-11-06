const registerForm = document.getElementById("register-form");
const nameInput = document.getElementById("register-name");
const emailInput = document.getElementById("register-email");
const passwordInput = document.getElementById("register-password");
const nameError = document.getElementById("name-error");
const emailError = document.getElementById("email-error");
const passwordError = document.getElementById("password-error");
const registerStatus = document.getElementById("register-status");


registerForm.noValidate = true;
registerForm.addEventListener("submit", checkRegistration);

function checkRegistration(event) {
  event.preventDefault();

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

  if (email === "" || emailInput.validity.typeMismatch || !email.endsWith("@drexel.edu")) {
    emailError.textContent = "Enter a valid Drexel University email address.";
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

  registerStatus.textContent = "Your details pass validation. Registration is not connected yet, so no account has been created.";
}
