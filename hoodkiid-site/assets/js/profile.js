(function () {
  "use strict";

  const notice = document.getElementById("profileNotice");
  const workspace = document.getElementById("profileWorkspace");
  const signOutButton = document.getElementById("profileSignOut");
  let user = null;
  let orderVariants = [];

  function showNotice(text, tone) {
    notice.hidden = false;
    notice.textContent = text;
    if (tone) notice.dataset.tone = tone;
    else delete notice.dataset.tone;
  }

  function orderEditForm(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const supported = items.length && items.every(function (item) {
      return item.product_id && item.variant_id && orderVariants.some(function (variant) {
        return String(variant.id) === String(item.variant_id);
      });
    });
    if (!supported) {
      return "<p class=\"muted\">Size and colour options could not be loaded for editing. Refresh the page or contact HOODKIID.</p>";
    }
    return '<form class="order-edit-form" data-order-id="' + HK.escapeHtml(order.id) + '">' +
      items.map(function (item, index) {
        const variants = orderVariants.filter(function (variant) {
          return String(variant.product_id) === String(item.product_id) &&
            (Number(variant.stock) > 0 || String(variant.id) === String(item.variant_id));
        });
        const sizes = Array.from(new Set(variants.map(function (variant) { return variant.size; }).concat(item.size)));
        const colors = Array.from(new Set(variants.map(function (variant) { return variant.color; }).concat(item.color)));
        return '<div class="order-edit-line" data-product-id="' + HK.escapeHtml(item.product_id) +
          '" data-current-variant="' + HK.escapeHtml(item.variant_id) + '">' +
          "<strong>" + HK.escapeHtml(item.name) + "</strong>" +
          '<div class="order-edit-options">' +
          '<label>Size<select class="field" data-order-size>' + sizes.map(function (size) {
            return '<option value="' + HK.escapeHtml(size) + '"' + (size === item.size ? " selected" : "") + ">" +
              HK.escapeHtml(size) + "</option>";
          }).join("") + "</select></label>" +
          '<label>Colour<select class="field" data-order-color>' + colors.map(function (color) {
            return '<option value="' + HK.escapeHtml(color) + '"' + (color === item.color ? " selected" : "") + ">" +
              HK.escapeHtml(color) + "</option>";
          }).join("") + "</select></label>" +
          '<label>Quantity<input class="field" data-order-quantity type="number" min="1" max="20" step="1" required value="' +
          Number(item.quantity) + '"></label></div>' +
          '<p class="form-message" data-order-edit-message role="status" aria-live="polite"></p>' +
          '<input type="hidden" data-order-selected-variant value=""></div>';
      }).join("") +
      '<p class="muted">Saving changes recalculates the item total and delivery fee. Please use the updated total and wait for any new delivery quote before paying.</p>' +
      '<button class="button button-dark" type="submit">Save order changes</button>' +
      '<p class="form-message" data-order-save-message role="status" aria-live="polite"></p></form>';
  }

  function formatOrder(order) {
    const items = (Array.isArray(order.items) ? order.items : []).map(function (item) {
      const options = [item.size, item.color].filter(Boolean).map(HK.escapeHtml).join(" / ");
      return HK.escapeHtml(item.name) + " · " + options + " × " + Number(item.quantity);
    }).join("<br>");
    const canEdit = order.payment_status === "awaiting_payment" &&
      ["awaiting_payment", "awaiting_quote"].includes(order.order_status);
    return '<article class="order-card"><header><h3>' + HK.escapeHtml(order.order_reference) +
      '</h3><span>' + HK.escapeHtml(new Date(order.created_at).toLocaleString("en-ZA")) + "</span></header>" +
      "<p>Status: <strong>" + HK.escapeHtml(String(order.order_status).replaceAll("_", " ")) +
      "</strong><br>Payment: " + HK.escapeHtml(String(order.payment_status).replaceAll("_", " ")) +
      "</p><p>" + items + "</p><p>Items: " + HK.money(order.subtotal) +
      " · Delivery: " + (order.delivery_fee == null ? "to confirm" : HK.money(order.delivery_fee)) +
      " · Total: " + (order.total == null ? "to confirm" : HK.money(order.total)) + "</p>" +
      (canEdit ? orderEditForm(order) : "") + "</article>";
  }

  function validateOrderEditForm(form) {
    let valid = true;
    form.querySelectorAll(".order-edit-line").forEach(function (line) {
      const size = line.querySelector("[data-order-size]").value;
      const color = line.querySelector("[data-order-color]").value;
      const quantity = Number(line.querySelector("[data-order-quantity]").value);
      const variant = orderVariants.find(function (option) {
        return String(option.product_id) === line.dataset.productId &&
          option.size === size && option.color === color &&
          (Number(option.stock) > 0 || String(option.id) === line.dataset.currentVariant);
      });
      const message = line.querySelector("[data-order-edit-message]");
      if (!variant) {
        message.textContent = "That size and colour combination is unavailable.";
        valid = false;
      } else if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        message.textContent = "Quantity must be between 1 and 20.";
        valid = false;
      } else {
        line.querySelector("[data-order-selected-variant]").value = variant.id;
        message.textContent = "";
      }
    });
    form.querySelector('button[type="submit"]').disabled = !valid;
    return valid;
  }

  async function loadCustomerOrders() {
    const list = document.getElementById("customerOrders");
    list.innerHTML = "<p>Loading your orders…</p>";
    const result = await HK.client.from("orders")
      .select("id,order_reference,subtotal,delivery_fee,total,order_status,payment_status,created_at,items")
      .order("created_at", { ascending: false });
    if (result.error) {
      list.innerHTML = "<p>Orders could not be loaded. Please refresh to try again.</p>";
      console.error("Could not load customer orders:", result.error);
      return;
    }
    const hasEditableOrders = (result.data || []).some(function (order) {
      return order.payment_status === "awaiting_payment" &&
        ["awaiting_payment", "awaiting_quote"].includes(order.order_status);
    });
    orderVariants = [];
    if (hasEditableOrders) {
      const variantsResult = await HK.client.from("product_variants")
        .select("id,product_id,size,color,stock");
      if (variantsResult.error) {
        console.error("Could not load order edit variants:", variantsResult.error);
        showNotice("Order history loaded, but available size and colour options could not be loaded. Refresh or contact HOODKIID before paying.", "error");
      } else {
        orderVariants = variantsResult.data || [];
      }
    }
    list.innerHTML = (result.data || []).map(formatOrder).join("") || "<p>You have no orders yet.</p>";
    list.querySelectorAll(".order-edit-form").forEach(validateOrderEditForm);
  }

  document.getElementById("customerOrders").addEventListener("change", function (event) {
    if (!event.target.matches("[data-order-size],[data-order-color]")) return;
    validateOrderEditForm(event.target.closest(".order-edit-form"));
  });
  document.getElementById("customerOrders").addEventListener("input", function (event) {
    if (!event.target.matches("[data-order-quantity]")) return;
    validateOrderEditForm(event.target.closest(".order-edit-form"));
  });
  document.getElementById("customerOrders").addEventListener("submit", async function (event) {
    const form = event.target.closest(".order-edit-form");
    if (!form) return;
    event.preventDefault();
    if (!validateOrderEditForm(form)) return;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[data-order-save-message]");
    const items = Array.from(form.querySelectorAll(".order-edit-line")).map(function (line) {
      return {
        variant_id: line.querySelector("[data-order-selected-variant]").value,
        quantity: Number(line.querySelector("[data-order-quantity]").value)
      };
    });
    button.disabled = true;
    button.textContent = "Saving changes…";
    message.textContent = "";
    try {
      const result = await HK.client.rpc("edit_own_unpaid_order", {
        p_order_id: form.dataset.orderId,
        p_items: items
      });
      if (result.error) {
        console.error("Could not edit unpaid order:", result.error);
        const serverMessage = String(result.error.message || "");
        message.textContent = /insufficient stock|unavailable|no longer available/i.test(serverMessage)
          ? "A selected size, colour, or quantity is no longer available. Review your selections and try again."
          : "Could not update this order. Refresh the page and try again.";
        message.dataset.tone = "error";
        button.disabled = false;
        button.textContent = "Save order changes";
        return;
      }
      const updated = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!updated) {
        message.textContent = "The order update could not be confirmed. Refresh your order history before paying.";
        message.dataset.tone = "error";
        button.disabled = false;
        button.textContent = "Save order changes";
        return;
      }
      const lastOrder = HK.readLastOrder();
      if (lastOrder && lastOrder.reference === updated.order_reference) {
        try {
          HK.saveLastOrder({
            reference: updated.order_reference,
            subtotal: updated.subtotal,
            total: updated.total,
            status: updated.order_status
          });
        } catch (error) {
          console.warn("Could not update the local order confirmation:", error);
        }
      }
      showNotice(updated.order_status === "awaiting_quote"
        ? "Order updated. Please wait for HOODKIID to confirm the new delivery fee before paying."
        : "Order updated. Use the new total shown in your order history before paying.", "");
      await loadCustomerOrders();
    } catch (error) {
      console.error("Could not reach the order edit service:", error);
      message.textContent = "Could not reach the order service. Your existing order is unchanged.";
      message.dataset.tone = "error";
      button.disabled = false;
      button.textContent = "Save order changes";
    }
  });

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
    const metadata = user.user_metadata || {};
    document.getElementById("profileFirstName").value = profile.first_name || metadata.first_name || "";
    document.getElementById("profileLastName").value = profile.last_name || metadata.last_name || "";
    document.getElementById("profileWhatsappPhone").value = profile.whatsapp_phone || metadata.whatsapp_phone || "";
    document.getElementById("profileCallPhone").value = profile.call_phone || metadata.call_phone || "";
  }

  async function loadPrivacyRequest() {
    const message = document.getElementById("privacyMessage");
    const result = await HK.client.from("privacy_requests")
      .select("status,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (result.error) {
      console.error("Could not load privacy request status:", result.error);
      HK.setMessage(message, "Your deletion request status could not be loaded. Please refresh.", "error");
      return;
    }
    const request = (result.data || [])[0];
    if (!request) return;
    const open = request.status === "pending" || request.status === "in_review";
    document.getElementById("requestDeletion").disabled = open;
    HK.setMessage(message, open
      ? "Your deletion request is " + request.status.replaceAll("_", " ") + ". We will contact you about the next steps."
      : "Your most recent deletion request was " + request.status.replaceAll("_", " ") + ".", "");
  }

  async function initialize() {
    const unavailable = HK.databaseMessage();
    if (unavailable) {
      showNotice(unavailable, "error");
      return;
    }
    const sessionResult = await HK.client.auth.getSession();
    if (sessionResult.error) {
      showNotice("Could not check your sign-in. Please refresh and try again.", "error");
      return;
    }
    if (!sessionResult.data.session) {
      window.location.replace("account.html?next=profile");
      return;
    }
    user = sessionResult.data.session.user;
    showNotice("", "");
    notice.hidden = true;
    workspace.hidden = false;
    signOutButton.hidden = false;
    document.getElementById("profileEmail").textContent = user.email || "HOODKIID account";
    const metadata = user.user_metadata || {};
    document.getElementById("profileWelcome").textContent = "Welcome back" +
      (metadata.first_name ? ", " + metadata.first_name : "") +
      ". Manage your details, keep up with orders, and control your personal information.";
    const access = await HK.client.from("admin_users").select("role").eq("user_id", user.id).maybeSingle();
    if (access.error) {
      console.error("Could not check admin access:", access.error);
    } else if (access.data) {
      document.getElementById("adminLink").hidden = false;
    }
    await Promise.all([loadProfile(), loadCustomerOrders(), loadPrivacyRequest()]);
  }

  document.getElementById("profileForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!user) return;
    const button = document.getElementById("saveProfile");
    button.disabled = true;
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
      HK.setMessage(document.getElementById("profileMessage"), "Your contact details have been updated.", "");
    } catch (error) {
      console.error("Could not update customer profile:", error);
      HK.setMessage(document.getElementById("profileMessage"), error.message || "Could not update your details.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("downloadData").addEventListener("click", async function () {
    const button = document.getElementById("downloadData");
    const message = document.getElementById("privacyMessage");
    button.disabled = true;
    try {
      const results = await Promise.all([
        HK.client.from("customer_profiles").select("first_name,last_name,whatsapp_phone,call_phone,created_at").eq("user_id", user.id).maybeSingle(),
        HK.client.from("orders").select("order_reference,customer_name,phone,whatsapp_phone,email,fulfilment,fulfilment_details,subtotal,delivery_fee,total,order_status,payment_status,items,created_at").order("created_at", { ascending: false }),
        HK.client.from("subscribers").select("email,created_at").ilike("email", user.email || ""),
        HK.client.from("privacy_requests").select("request_type,status,created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
        HK.client.from("admin_users").select("role,created_at").eq("user_id", user.id).maybeSingle()
      ]);
      const failed = results.find(function (result) { return result.error; });
      if (failed) throw failed.error;
      let storefrontCart = [];
      try {
        const cartData = JSON.parse(localStorage.getItem("hk_cart") || "[]");
        if (Array.isArray(cartData)) storefrontCart = cartData;
      } catch (error) {
        console.error("Could not read the local storefront cart for export:", error);
      }
      const dataCopy = {
        exported_at: new Date().toISOString(),
        account: {
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          user_metadata: user.user_metadata
        },
        customer_profile: results[0].data,
        orders: results[1].data || [],
        newsletter_subscriptions: results[2].data || [],
        privacy_requests: results[3].data || [],
        team_access: results[4].data || null,
        browser_cart: storefrontCart
      };
      const blob = new Blob([JSON.stringify(dataCopy, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "hoodkiid-information-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      HK.setMessage(message, "Your information copy has been downloaded.", "");
    } catch (error) {
      console.error("Could not prepare information copy:", error);
      HK.setMessage(message, error.message || "Could not prepare your information copy. Please try again.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("requestDeletion").addEventListener("click", async function () {
    const button = document.getElementById("requestDeletion");
    const message = document.getElementById("privacyMessage");
    if (!window.confirm("Send HOODKIID a request to delete your account? We will review the request and explain any records we must retain by law.")) return;
    button.disabled = true;
    try {
      const result = await HK.client.from("privacy_requests").insert({ user_id: user.id, request_type: "deletion" });
      if (result.error) throw result.error;
      HK.setMessage(message, "Your deletion request has been submitted. HOODKIID will contact you about the next steps.", "");
      await loadPrivacyRequest();
    } catch (error) {
      console.error("Could not submit account deletion request:", error);
      HK.setMessage(message, error.code === "23505"
        ? "A deletion request is already being reviewed."
        : error.message || "Could not submit your request. Please try again.", "error");
      button.disabled = false;
    }
  });

  document.getElementById("refreshCustomerOrders").addEventListener("click", function () {
    loadCustomerOrders().catch(function (error) {
      console.error("Could not refresh customer orders:", error);
      document.getElementById("customerOrders").innerHTML = "<p>Orders could not be loaded. Please refresh to try again.</p>";
    });
  });

  signOutButton.addEventListener("click", async function () {
    signOutButton.disabled = true;
    try {
      const result = await HK.client.auth.signOut();
      if (result.error) {
        showNotice(result.error.message, "error");
        return;
      }
      window.location.assign("account.html");
    } catch (error) {
      console.error("Could not sign out:", error);
      showNotice(error.message || "Could not sign out.", "error");
    } finally {
      signOutButton.disabled = false;
    }
  });

  initialize().catch(function (error) {
    console.error("Profile could not be loaded:", error);
    showNotice(error.message || "Your profile could not be loaded. Please refresh and try again.", "error");
  });
}());
