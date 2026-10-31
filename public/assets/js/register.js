const registerForm = document.getElementById("register-form");
const emailInput = document.getElementById("register-email");
const passwordInput = document.getElementById("register-password");
const emailError = document.getElementById("email-error");
const passwordError = document.getElementById("password-error");
const registerStatus = document.getElementById("register-status");

registerForm.addEventListener("submit", checkRegistration);

function checkRegistration(event) {
 
  event.preventDefault();

  emailError.textContent = "";
  passwordError.textContent = "";
  registerStatus.textContent = "";
  emailInput.setAttribute("aria-invalid", "false");
  passwordInput.setAttribute("aria-invalid", "false");

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  let valid = true;

  if (email === "" || emailInput.validity.typeMismatch || !email.toLowerCase().endsWith("@drexel.edu")) {
    emailError.textContent = "Registration is restricted to active Drexel University email addresses (@drexel.edu).";
    emailInput.setAttribute("aria-invalid", "true");
    valid = false;
  }


  //password check [TEMP]
  //need to encrypt password
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
    if (emailError.textContent !== "") {
      emailInput.focus();
    } else {
      passwordInput.focus();
    }
    return;
  }

  // Supabase signup will be connected after issue #20 is ready and Supabase is connected [TEMP]
  registerStatus.textContent = "Passes validations so far";
}
