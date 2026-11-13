(function () {
  "use strict";

  const form = document.getElementById("accountForm");
  const message = document.getElementById("accountMessage");
  const submit = document.getElementById("accountSubmit");
  const signInTab = document.getElementById("signInTab");
  const signUpTab = document.getElementById("signUpTab");
  const profileFields = document.getElementById("profileFields");
  const privacyAcknowledgement = document.getElementById("privacyAcknowledgement");
  let mode = "signin";

  function redirectAfterSignIn() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next === "admin") {
      window.location.assign("admin.html");
    } else if (next === "checkout") {
      window.location.assign("../hoodkiid-storefront.html?checkout=1");
    } else {
      window.location.assign("profile.html");
    }
  }

  function selectMode(nextMode) {
    mode = nextMode;
    const signingIn = mode === "signin";
    signInTab.classList.toggle("active", signingIn);
    signUpTab.classList.toggle("active", !signingIn);
    signInTab.setAttribute("aria-selected", String(signingIn));
    signUpTab.setAttribute("aria-selected", String(!signingIn));
    profileFields.hidden = signingIn;
    profileFields.querySelectorAll("input").forEach(function (input) {
      input.required = !signingIn && input.id !== "callPhone";
    });
    privacyAcknowledgement.required = !signingIn;
    document.getElementById("accountPassword").autocomplete = signingIn ? "current-password" : "new-password";
    submit.textContent = signingIn ? "Sign in" : "Create account";
    HK.setMessage(message, "", "");
  }

  async function initialize() {
    const unavailable = HK.databaseMessage();
    if (unavailable) {
      HK.setMessage(message, unavailable, "error");
      return;
    }
    const result = await HK.client.auth.getSession();
    if (result.error) {
      HK.setMessage(message, result.error.message, "error");
      return;
    }
    if (result.data.session) redirectAfterSignIn();
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
    try {
      const result = mode === "signin"
        ? await HK.client.auth.signInWithPassword({ email: email, password: password })
        : await HK.client.auth.signUp({
          email: email,
          password: password,
          options: {
            emailRedirectTo: new URL("account.html", window.location.href).href,
            data: {
              first_name: document.getElementById("firstName").value.trim(),
              last_name: document.getElementById("lastName").value.trim(),
              call_phone: document.getElementById("callPhone").value.trim(),
              whatsapp_phone: document.getElementById("whatsappPhone").value.trim()
            }
          }
        });
      if (result.error) {
        HK.setMessage(message, result.error.message, "error");
        return;
      }
      if (mode === "signup" && !result.data.session) {
        HK.setMessage(message, "Account created. Check your email to confirm it, then sign in.", "");
        return;
      }
      redirectAfterSignIn();
    } catch (error) {
      console.error("Account request failed:", error);
      HK.setMessage(message, error.message || "Account request failed. Please try again.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  selectMode("signin");
  initialize().catch(function (error) {
    console.error("Account could not be loaded:", error);
    HK.setMessage(message, error.message || "Account could not be loaded. Please refresh and try again.", "error");
  });
}());
