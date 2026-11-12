(function () {
  "use strict";

  const form = document.getElementById("accountForm");
  const authPanel = document.getElementById("authPanel");
  const dashboard = document.getElementById("accountDashboard");
  const message = document.getElementById("accountMessage");
  const submit = document.getElementById("accountSubmit");
  const signInTab = document.getElementById("signInTab");
  const signUpTab = document.getElementById("signUpTab");
  const profileFields = document.getElementById("profileFields");
  let mode = "signin";
  let user = null;

  function redirectForNext() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next === "admin") {
      window.location.assign("admin.html");
      return true;
    }
    if (next === "checkout") {
      window.location.assign("../hoodkiid-storefront.html?checkout=1");
      return true;
    }
    return false;
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
    document.getElementById("accountPassword").autocomplete = signingIn ? "current-password" : "new-password";
    submit.textContent = signingIn ? "Sign in" : "Create account";
    HK.setMessage(message, "", "");
  }

  function showDashboard() {
    authPanel.hidden = true;
    dashboard.hidden = false;
  }

  async function loadCustomerOrders() {
    const list = document.getElementById("customerOrders");
    list.innerHTML = "<p>Loading your orders…</p>";
    const result = await HK.client.from("orders")
      .select("id,order_reference,subtotal,delivery_fee,total,order_status,payment_status,created_at,items")
      .neq("order_status", "completed")
      .neq("order_status", "cancelled")
      .order("created_at", { ascending: false });
    if (result.error) {
      list.innerHTML = "<p>Orders could not be loaded. Please refresh to try again.</p>";
      console.error("Could not load customer orders:", result.error);
      return;
    }
    const orders = result.data || [];
    list.innerHTML = orders.length ? orders.map(function (order) {
      const items = (order.items || []).map(function (item) {
        return HK.escapeHtml(item.name) + " · " + HK.escapeHtml(item.size) + " / " +
          HK.escapeHtml(item.color) + " × " + Number(item.quantity);
      }).join("<br>");
      return '<article class="order-card"><header><h3>' + HK.escapeHtml(order.order_reference) +
        '</h3><span>' + HK.escapeHtml(new Date(order.created_at).toLocaleString("en-ZA")) + "</span></header>" +
        "<p>Status: <strong>" + HK.escapeHtml(String(order.order_status).replaceAll("_", " ")) +
        "</strong><br>Payment: " + HK.escapeHtml(String(order.payment_status).replaceAll("_", " ")) +
        "</p><p>" + items + "</p><p>Items: " + HK.money(order.subtotal) +
        " · Delivery: " + (order.delivery_fee == null ? "to confirm" : HK.money(order.delivery_fee)) +
        " · Total: " + (order.total == null ? "to confirm" : HK.money(order.total)) + "</p></article>";
    }).join("") : "<p>You have no active orders yet.</p>";
  }

  async function loadProfile() {
    const result = await HK.client.from("customer_profiles")
      .select("first_name,last_name,whatsapp_phone,call_phone")
      .eq("user_id", user.id)
      .maybeSingle();
    if (result.error) {
      HK.setMessage(document.getElementById("profileMessage"), result.error.message, "error");
      return;
    }
    const profile = result.data || {};
    document.getElementById("profileFirstName").value = profile.first_name || "";
    document.getElementById("profileLastName").value = profile.last_name || "";
    document.getElementById("profileWhatsappPhone").value = profile.whatsapp_phone || "";
    document.getElementById("profileCallPhone").value = profile.call_phone || "";
    if (!result.data) {
      HK.setMessage(document.getElementById("profileMessage"), "Add your contact details to place and track orders.", "");
    }
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
    if (!result.data.session) return;
    user = result.data.session.user;
    if (redirectForNext()) return;
    showDashboard();
    await Promise.all([loadProfile(), loadCustomerOrders()]);
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
      user = result.data.user || result.data.session.user;
      if (redirectForNext()) return;
      showDashboard();
      await Promise.all([loadProfile(), loadCustomerOrders()]);
    } catch (error) {
      console.error("Account request failed:", error);
      HK.setMessage(message, error.message || "Account request failed. Please try again.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById("profileForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!user) return;
    const saveButton = event.currentTarget.querySelector('button[type="submit"]');
    saveButton.disabled = true;
    const profile = {
      user_id: user.id,
      first_name: document.getElementById("profileFirstName").value.trim(),
      last_name: document.getElementById("profileLastName").value.trim(),
      whatsapp_phone: document.getElementById("profileWhatsappPhone").value.trim(),
      call_phone: document.getElementById("profileCallPhone").value.trim() || null
    };
    try {
      const result = await HK.client.from("customer_profiles").upsert(profile, { onConflict: "user_id" });
      if (result.error) {
        HK.setMessage(document.getElementById("profileMessage"), result.error.message, "error");
        return;
      }
      HK.setMessage(document.getElementById("profileMessage"), "Contact details saved.", "");
    } catch (error) {
      console.error("Could not save customer profile:", error);
      HK.setMessage(document.getElementById("profileMessage"), error.message || "Could not save contact details.", "error");
    } finally {
      saveButton.disabled = false;
    }
  });

  document.getElementById("refreshCustomerOrders").addEventListener("click", function () {
    loadCustomerOrders().catch(function (error) {
      console.error("Could not refresh customer orders:", error);
      document.getElementById("customerOrders").innerHTML = "<p>Orders could not be loaded. Please refresh to try again.</p>";
    });
  });

  document.getElementById("accountSignOut").addEventListener("click", async function () {
    const button = document.getElementById("accountSignOut");
    button.disabled = true;
    try {
      const result = await HK.client.auth.signOut();
      if (result.error) {
        HK.setMessage(document.getElementById("profileMessage"), result.error.message, "error");
        return;
      }
      window.location.assign("account.html");
    } catch (error) {
      console.error("Could not sign out:", error);
      HK.setMessage(document.getElementById("profileMessage"), error.message || "Could not sign out.", "error");
    } finally {
      button.disabled = false;
    }
  });

  selectMode("signin");
  initialize().catch(function (error) {
    console.error("Account could not be loaded:", error);
    HK.setMessage(message, error.message || "Account could not be loaded. Please refresh and try again.", "error");
  });
}());
