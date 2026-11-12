(function () {
  "use strict";

  const form = document.getElementById("accountForm");
  const message = document.getElementById("accountMessage");
  const submit = document.getElementById("accountSubmit");
  const signInTab = document.getElementById("signInTab");
  const signUpTab = document.getElementById("signUpTab");
  let mode = "signin";

  function selectMode(nextMode) {
    mode = nextMode;
    const signingIn = mode === "signin";
    signInTab.classList.toggle("active", signingIn);
    signUpTab.classList.toggle("active", !signingIn);
    signInTab.setAttribute("aria-selected", String(signingIn));
    signUpTab.setAttribute("aria-selected", String(!signingIn));
    submit.textContent = signingIn ? "Sign in" : "Create account";
  }

  signInTab.addEventListener("click", function () { selectMode("signin"); });
  signUpTab.addEventListener("click", function () { selectMode("signup"); });
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const unavailable = HK.databaseMessage();
    if (unavailable) {
      HK.setMessage(message, unavailable, "error");
      return;
    }
    submit.disabled = true;
    const email = document.getElementById("accountEmail").value.trim();
    const password = document.getElementById("accountPassword").value;
    const result = mode === "signin"
      ? await HK.client.auth.signInWithPassword({ email: email, password: password })
      : await HK.client.auth.signUp({ email: email, password: password });
    submit.disabled = false;
    if (result.error) {
      HK.setMessage(message, result.error.message, "error");
      return;
    }
    if (mode === "signup" && !result.data.session) {
      HK.setMessage(message, "Account created. Check your email to confirm it, then sign in.", "");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.assign(next === "admin" ? "admin.html" : "index.html");
  });
}());
