(function () {
  "use strict";

  const notice = document.getElementById("adminNotice");
  const workspace = document.getElementById("adminWorkspace");
  const ordersList = document.getElementById("ordersList");
  const signOut = document.getElementById("signOut");
  const teamTab = document.getElementById("teamTab");
  const productImagesBucket = "product-images";
  const maxProductImages = 5;
  const maxProductImageBytes = 8 * 1024 * 1024;
  const allowedImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const panels = {
    orders: document.getElementById("ordersPanel"),
    products: document.getElementById("productsPanel"),
    accounts: document.getElementById("accountsPanel"),
    pickup: document.getElementById("pickupPanel"),
    privacy: document.getElementById("privacyPanel"),
    team: document.getElementById("teamPanel")
  };
  let isOwner = false;

  function showNotice(text, tone) {
    notice.hidden = false;
    notice.textContent = text;
    if (tone) notice.dataset.tone = tone;
    else delete notice.dataset.tone;
  }

  function showFormMessage(id, text, tone) {
    const node = document.getElementById(id);
    if (node) HK.setMessage(node, text, tone);
  }

  function validateImageFiles(files, remainingSlots) {
    if (!files.length) throw new Error("Choose at least one product image.");
    if (files.length > remainingSlots) throw new Error("A product can have no more than " + maxProductImages + " images.");
    files.forEach(function (file) {
      if (!allowedImageTypes.includes(file.type)) {
        throw new Error("Use JPEG, PNG, WebP or GIF images.");
      }
      if (file.size === 0 || file.size > maxProductImageBytes) {
        throw new Error("Choose a non-empty image no larger than 8 MB.");
      }
    });
  }

  async function uploadProductImages(files, remainingSlots) {
    validateImageFiles(files, remainingSlots);
    const uploaded = [];
    const extensionByType = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif"
    };
    try {
      for (const file of files) {
        const suffix = window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : Date.now() + "-" + Math.random().toString(36).slice(2);
        const path = "products/" + suffix + "." + extensionByType[file.type];
        const result = await HK.client.storage.from(productImagesBucket).upload(path, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: false
        });
        if (result.error) throw result.error;
        const publicUrl = HK.client.storage.from(productImagesBucket).getPublicUrl(path).data.publicUrl;
        uploaded.push({ path: path, url: publicUrl });
      }
      return uploaded;
    } catch (error) {
      if (uploaded.length) {
        const cleanup = await HK.client.storage.from(productImagesBucket).remove(uploaded.map(function (image) { return image.path; }));
        if (cleanup.error) console.error("Could not clean up incomplete product image upload:", cleanup.error);
      }
      throw error;
    }
  }

  async function removeUploadedImages(images) {
    if (!images.length) return;
    const result = await HK.client.storage.from(productImagesBucket).remove(images.map(function (image) { return image.path; }));
    if (result.error) console.error("Could not remove images after a failed product save:", result.error);
  }

  async function loadOrders() {
    ordersList.innerHTML = "<p>Loading orders…</p>";
    const result = await HK.client.from("orders")
      .select("id,order_reference,customer_name,phone,whatsapp_phone,email,fulfilment,fulfilment_details,subtotal,delivery_fee,total,order_status,payment_status,created_at,items")
      .order("created_at", { ascending: false }).limit(100);
    if (result.error) {
      ordersList.innerHTML = "";
      showNotice("Could not load orders. Check your admin role and database policies, then try again.", "error");
      return;
    }
    const statuses = ["awaiting_quote", "awaiting_payment", "paid", "processing", "ready_for_pickup", "shipped", "completed", "cancelled"];
    ordersList.innerHTML = result.data.length ? result.data.map(function (order) {
      const callNumber = order.phone && order.phone !== order.whatsapp_phone
        ? "<br>Call: " + HK.escapeHtml(order.phone)
        : "";
      const itemLines = (order.items || []).map(function (item) {
        return HK.escapeHtml(item.name) + " · " + HK.escapeHtml(item.size) + " · " + item.quantity;
      }).join("<br>");
      return '<article class="order-card"><header><h3>' + HK.escapeHtml(order.order_reference) +
        '</h3><span>' + HK.escapeHtml(new Date(order.created_at).toLocaleString("en-ZA")) + "</span></header>" +
        "<p><strong>" + HK.escapeHtml(order.customer_name) + "</strong>" +
        callNumber + "<br>WhatsApp: " + HK.escapeHtml(order.whatsapp_phone) +
        "<br>" + HK.escapeHtml(order.email) + "<br>" + HK.escapeHtml(order.fulfilment) + ": " +
        HK.escapeHtml(order.fulfilment_details) + "</p><p>" + itemLines + "</p><p>Items: " + HK.money(order.subtotal) +
        " · Delivery: " + (order.delivery_fee == null ? "to confirm" : HK.money(order.delivery_fee)) +
        " · Total: " + (order.total == null ? "to confirm" : HK.money(order.total)) + "</p><div class=\"order-actions\">" +
        (order.delivery_fee == null ? '<label class="sr-only" for="fee-' + order.id + '">Delivery fee</label><input class="field" id="fee-' +
          order.id + '" type="number" min="0" step="0.01" placeholder="Delivery fee (R)">' : "") +
        '<select class="field" data-payment="' + order.id + '" aria-label="Payment verification">' +
        '<option value="awaiting_payment"' + (order.payment_status === "awaiting_payment" ? " selected" : "") + '>Awaiting payment</option>' +
        '<option value="verified"' + (order.payment_status === "verified" ? " selected" : "") + '>Verified in bank</option>' +
        '<option value="rejected"' + (order.payment_status === "rejected" ? " selected" : "") + '>Payment not found</option></select>' +
        '<select class="field" data-status="' + order.id + '" aria-label="Order fulfilment status">' +
        statuses.map(function (status) { return '<option value="' + status + '"' + (order.order_status === status ? " selected" : "") + '>' +
          HK.escapeHtml(status.replaceAll("_", " ")) + "</option>"; }).join("") + '</select>' +
        '<button class="button button-dark" type="button" data-save="' + order.id + '">Save order</button></div></article>';
    }).join("") : "<p>No orders yet.</p>";
  }

  async function loadProducts() {
    const list = document.getElementById("productsList");
    const result = await HK.client.from("products")
      .select("id,name,category,description,price,active,image_urls,product_variants(id,size,color,stock)")
      .order("created_at", { ascending: false });
    if (result.error) {
      list.innerHTML = "";
      showNotice("Could not load products or stock.", "error");
      return;
    }
    const products = result.data || [];
    document.getElementById("variantProduct").innerHTML = products.map(function (product) {
      return '<option value="' + HK.escapeHtml(product.id) + '">' + HK.escapeHtml(product.name) + "</option>";
    }).join("");
    list.innerHTML = products.length ? products.map(function (product) {
      const images = product.image_urls || [];
      const thumbnails = images.map(function (image, index) {
        return '<img class="product-admin-thumbnail" src="' + HK.escapeHtml(image) + '" alt="' +
          HK.escapeHtml(product.name + " image " + (index + 1)) + '" loading="lazy">';
      }).join("");
      const variants = (product.product_variants || []).map(function (variant) {
        return '<div class="stock-row"><span>' + HK.escapeHtml(variant.size) + " / " + HK.escapeHtml(variant.color) +
          '</span><input class="field" type="number" min="0" step="1" value="' + variant.stock +
          '" aria-label="Stock for ' + HK.escapeHtml(variant.size + " " + variant.color) + '"><button class="button button-light" type="button" data-stock="' +
          HK.escapeHtml(variant.id) + '">Save stock</button></div>';
      }).join("") || "<p>No variants configured.</p>";
      return '<article class="admin-item product-admin-item"><div><h3>' + HK.escapeHtml(product.name) + '</h3><p>' + HK.escapeHtml(product.category) +
        " · " + HK.money(product.price) + " · " + (product.active ? "Live" : "Hidden") + '</p><label class="sr-only" for="price-' +
        product.id + '">Price</label><input class="field" id="price-' + product.id + '" type="number" min="0" step="0.01" value="' +
        Number(product.price) + '"></div><button class="button button-light" type="button" data-product="' + HK.escapeHtml(product.id) +
        '" data-active="' + String(product.active) + '">Save price / ' + (product.active ? "hide" : "publish") +
        '</button><div class="product-admin-images">' + (thumbnails || '<p class="muted">No images uploaded yet. This product cannot be published without an image.</p>') +
        '<label for="images-' + HK.escapeHtml(product.id) + '">Add product images</label><input class="field" id="images-' +
        HK.escapeHtml(product.id) + '" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple data-images-for="' +
        HK.escapeHtml(product.id) + '"><button class="button button-light" type="button" data-add-images="' +
        HK.escapeHtml(product.id) + '">Upload images</button></div><div class="variant-list">' + variants + "</div></article>";
    }).join("") : "<p>No products have been added.</p>";
  }

  async function loadAccounts() {
    const list = document.getElementById("accountsList");
    const result = await HK.client.from("payment_accounts")
      .select("id,bank_name,account_holder,account_number,branch_code,account_type,active")
      .order("bank_name");
    if (result.error) {
      list.innerHTML = "";
      showNotice("Could not load bank accounts.", "error");
      return;
    }
    list.innerHTML = (result.data || []).map(function (account) {
      return '<article class="admin-item"><div><h3>' + HK.escapeHtml(account.bank_name) + '</h3><p>' +
        HK.escapeHtml(account.account_holder) + " · " + HK.escapeHtml(account.account_number) +
        (account.branch_code ? " · " + HK.escapeHtml(account.branch_code) : "") + " · " +
        (account.active ? "Active" : "Hidden") + '</p></div><button class="button button-light" type="button" data-account="' +
        HK.escapeHtml(account.id) + '" data-active="' + String(account.active) + '">' +
        (account.active ? "Hide" : "Show") + "</button></article>";
    }).join("") || "<p>No bank accounts configured.</p>";
  }

  async function loadPickupLocations() {
    const list = document.getElementById("pickupList");
    const result = await HK.client.from("pickup_locations").select("id,name,address,active").order("name");
    if (result.error) {
      list.innerHTML = "";
      showNotice("Could not load pickup locations.", "error");
      return;
    }
    list.innerHTML = (result.data || []).map(function (location) {
      return '<article class="admin-item"><div><h3>' + HK.escapeHtml(location.name) + '</h3><p>' +
        HK.escapeHtml(location.address) + " · " + (location.active ? "Active" : "Hidden") +
        '</p></div><button class="button button-light" type="button" data-pickup="' + HK.escapeHtml(location.id) +
        '" data-active="' + String(location.active) + '">' + (location.active ? "Hide" : "Show") + "</button></article>";
    }).join("") || "<p>No pickup locations configured.</p>";
  }

  async function loadTeam() {
    const list = document.getElementById("teamList");
    const result = await HK.client.rpc("admin_list_users");
    if (result.error) {
      list.innerHTML = "";
      showNotice("Could not load admin accounts.", "error");
      return;
    }
    list.innerHTML = (result.data || []).map(function (person) {
      return '<article class="admin-item"><div><h3>' + HK.escapeHtml(person.email) + '</h3><p>' +
        HK.escapeHtml(person.role) + '</p></div><button class="button button-light" type="button" data-revoke="' +
        HK.escapeHtml(person.user_id) + '">Remove admin</button></article>';
    }).join("") || "<p>No admin accounts found.</p>";
  }

  async function loadPrivacyRequests() {
    const list = document.getElementById("privacyRequestsList");
    const result = await HK.client.from("privacy_requests")
      .select("id,user_id,request_type,status,created_at")
      .order("created_at", { ascending: false });
    if (result.error) {
      list.innerHTML = "";
      showNotice("Could not load privacy requests.", "error");
      return;
    }
    const statuses = ["pending", "in_review", "completed", "declined"];
    list.innerHTML = (result.data || []).map(function (request) {
      return '<article class="order-card"><header><h3>' + HK.escapeHtml(request.request_type.replaceAll("_", " ")) +
        '</h3><span>' + HK.escapeHtml(new Date(request.created_at).toLocaleString("en-ZA")) + '</span></header><p>Account ID: ' +
        HK.escapeHtml(request.user_id || "Account removed") + "</p><div class=\"order-actions\"><select class=\"field\" data-privacy-status=\"" +
        HK.escapeHtml(request.id) + '" aria-label="Privacy request status">' + statuses.map(function (status) {
          return '<option value="' + status + '"' + (request.status === status ? " selected" : "") + ">" +
            HK.escapeHtml(status.replaceAll("_", " ")) + "</option>";
        }).join("") + '</select><button class="button button-dark" type="button" data-save-privacy="' +
        HK.escapeHtml(request.id) + '">Save status</button></div></article>';
    }).join("") || "<p>No privacy requests have been received.</p>";
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
    const session = sessionResult.data.session;
    if (!session) {
      window.location.replace("account.html?next=admin");
      return;
    }
    signOut.hidden = false;
    const access = await HK.client.from("admin_users").select("user_id,role").eq("user_id", session.user.id).maybeSingle();
    if (access.error || !access.data) {
      showNotice("This account is signed in but has not been assigned admin access. Ask the owner to grant the admin role.", "error");
      return;
    }
    isOwner = access.data.role === "owner";
    teamTab.hidden = !isOwner;
    notice.hidden = true;
    workspace.hidden = false;
    await loadOrders();
    await loadProducts();
    await loadAccounts();
    await loadPickupLocations();
    await loadPrivacyRequests();
    if (isOwner) await loadTeam();
  }

  document.querySelectorAll(".admin-tabs .tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      const key = tab.id.replace("Tab", "");
      document.querySelectorAll(".admin-tabs .tab").forEach(function (item) {
        item.classList.toggle("active", item === tab);
        item.setAttribute("aria-selected", String(item === tab));
      });
      Object.keys(panels).forEach(function (panelKey) { panels[panelKey].hidden = panelKey !== key; });
    });
  });

  document.getElementById("refreshOrders").addEventListener("click", loadOrders);
  document.getElementById("refreshPrivacyRequests").addEventListener("click", loadPrivacyRequests);
  signOut.addEventListener("click", async function () {
    const result = await HK.client.auth.signOut();
    if (result.error) {
      showNotice("Could not sign out. Please try again.", "error");
      return;
    }
    window.location.assign("account.html");
  });

  ordersList.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-save]");
    if (!button) return;
    button.disabled = true;
    const id = button.dataset.save;
    const feeInput = document.getElementById("fee-" + id);
    let result;
    if (feeInput && feeInput.value !== "") {
      const fee = Number(feeInput.value);
      if (!Number.isFinite(fee) || fee < 0) {
        showNotice("Enter a valid delivery fee.", "error");
        button.disabled = false;
        return;
      }
      result = await HK.client.rpc("set_order_delivery_fee", { p_order_id: id, p_delivery_fee: fee });
      if (result.error) {
        showNotice("Could not save the delivery fee. Please refresh and try again.", "error");
        button.disabled = false;
        return;
      }
    }
    const paymentStatus = ordersList.querySelector('[data-payment="' + id + '"]').value;
    let orderStatus = ordersList.querySelector('[data-status="' + id + '"]').value;
    if (feeInput && feeInput.value !== "" && orderStatus === "awaiting_quote") orderStatus = "awaiting_payment";
    if (paymentStatus === "verified" && orderStatus === "awaiting_payment") orderStatus = "paid";
    result = await HK.client.from("orders").update({ payment_status: paymentStatus, order_status: orderStatus }).eq("id", id);
    button.disabled = false;
    if (result.error) {
      showNotice("Could not save this order. Please refresh and try again.", "error");
      return;
    }
    showNotice("Order updated.", "");
    await loadOrders();
  });

  document.getElementById("productForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const files = Array.from(document.getElementById("productImages").files || []);
    let uploaded = [];
    button.disabled = true;
    try {
      uploaded = await uploadProductImages(files, maxProductImages);
      const result = await HK.client.rpc("admin_create_product", {
        p_name: document.getElementById("productName").value.trim(),
        p_category: document.getElementById("productCategory").value.trim(),
        p_description: document.getElementById("productDescription").value.trim(),
        p_price: Number(document.getElementById("productPrice").value),
        p_size: document.getElementById("variantSize").value.trim(),
        p_color: document.getElementById("variantColor").value.trim(),
        p_stock: Number(document.getElementById("variantStock").value),
        p_image_urls: uploaded.map(function (image) { return image.url; })
      });
      if (result.error) {
        await removeUploadedImages(uploaded);
        showNotice("Could not create product: " + result.error.message, "error");
        return;
      }
      event.target.reset();
      showNotice("Product and images added.", "");
      await loadProducts();
    } catch (error) {
      showNotice("Could not upload product images: " + (error.message || "Please check the file and try again."), "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("variantForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const result = await HK.client.from("product_variants").insert({
      product_id: document.getElementById("variantProduct").value,
      size: document.getElementById("extraSize").value.trim(),
      color: document.getElementById("extraColor").value.trim(),
      stock: Number(document.getElementById("extraStock").value)
    });
    if (result.error) {
      showNotice("Could not add that size/colour. It may already exist for this product.", "error");
      return;
    }
    event.target.reset();
    showNotice("Stock variant added.", "");
    await loadProducts();
  });

  document.getElementById("productsList").addEventListener("click", async function (event) {
    const productButton = event.target.closest("[data-product]");
    const stockButton = event.target.closest("[data-stock]");
    if (productButton) {
      const id = productButton.dataset.product;
      const product = (await HK.client.from("products").select("active,image_urls").eq("id", id).single());
      if (product.error) {
        showNotice("Could not read the product status.", "error");
        return;
      }
      if (!product.data.active && !(product.data.image_urls || []).length) {
        showNotice("Add at least one image before publishing this product.", "error");
        return;
      }
      const result = await HK.client.from("products").update({
        price: Number(document.getElementById("price-" + id).value),
        active: !product.data.active
      }).eq("id", id);
      if (result.error) {
        showNotice("Could not update product.", "error");
        return;
      }
      showNotice("Product updated.", "");
      await loadProducts();
      return;
    }
    const imageButton = event.target.closest("[data-add-images]");
    if (imageButton) {
      const id = imageButton.dataset.addImages;
      const input = document.getElementById("images-" + id);
      const files = Array.from(input.files || []);
      imageButton.disabled = true;
      let uploaded = [];
      try {
        const product = await HK.client.from("products").select("image_urls").eq("id", id).single();
        if (product.error) throw product.error;
        const currentImages = product.data.image_urls || [];
        uploaded = await uploadProductImages(files, maxProductImages - currentImages.length);
        const result = await HK.client.from("products").update({
          image_urls: currentImages.concat(uploaded.map(function (image) { return image.url; }))
        }).eq("id", id);
        if (result.error) {
          await removeUploadedImages(uploaded);
          throw result.error;
        }
        showNotice("Product images uploaded.", "");
        await loadProducts();
      } catch (error) {
        showNotice("Could not add product images: " + (error.message || "Please try again."), "error");
      } finally {
        imageButton.disabled = false;
      }
      return;
    }
    if (stockButton) {
      const row = stockButton.closest(".stock-row");
      const input = row.querySelector("input");
      const stock = Number(input.value);
      if (!Number.isInteger(stock) || stock < 0) {
        showNotice("Stock must be a non-negative whole number.", "error");
        return;
      }
      const result = await HK.client.from("product_variants").update({ stock: stock }).eq("id", stockButton.dataset.stock);
      if (result.error) {
        showNotice("Could not update stock.", "error");
        return;
      }
      showNotice("Stock updated.", "");
      await loadProducts();
    }
  });

  document.getElementById("bankForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const result = await HK.client.from("payment_accounts").insert({
      bank_name: document.getElementById("bankName").value.trim(),
      account_holder: document.getElementById("accountHolder").value.trim(),
      account_number: document.getElementById("accountNumber").value.trim(),
      branch_code: document.getElementById("branchCode").value.trim(),
      account_type: document.getElementById("accountType").value.trim()
    });
    if (result.error) {
      showNotice("Could not add bank account.", "error");
      return;
    }
    event.target.reset();
    showNotice("Bank account added.", "");
    await loadAccounts();
  });

  document.getElementById("accountsList").addEventListener("click", async function (event) {
    const button = event.target.closest("[data-account]");
    if (!button) return;
    const result = await HK.client.from("payment_accounts").update({ active: button.dataset.active !== "true" }).eq("id", button.dataset.account);
    if (result.error) {
      showNotice("Could not change bank account visibility.", "error");
      return;
    }
    await loadAccounts();
  });

  document.getElementById("pickupForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const result = await HK.client.from("pickup_locations").insert({
      name: document.getElementById("pickupName").value.trim(),
      address: document.getElementById("pickupAddress").value.trim()
    });
    if (result.error) {
      showNotice("Could not add pickup location.", "error");
      return;
    }
    event.target.reset();
    showNotice("Pickup location added.", "");
    await loadPickupLocations();
  });

  document.getElementById("pickupList").addEventListener("click", async function (event) {
    const button = event.target.closest("[data-pickup]");
    if (!button) return;
    const result = await HK.client.from("pickup_locations").update({ active: button.dataset.active !== "true" }).eq("id", button.dataset.pickup);
    if (result.error) {
      showNotice("Could not change pickup location visibility.", "error");
      return;
    }
    await loadPickupLocations();
  });

  document.getElementById("grantAdminForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!isOwner) {
      showFormMessage("teamMessage", "Only the owner can grant admin access.", "error");
      return;
    }
    const result = await HK.client.rpc("admin_grant_user", { p_email: document.getElementById("adminEmail").value.trim() });
    if (result.error) {
      showFormMessage("teamMessage", "Could not grant access. Confirm the user already has an account.", "error");
      return;
    }
    event.target.reset();
    showFormMessage("teamMessage", "Admin access granted.", "");
    await loadTeam();
  });

  document.getElementById("teamList").addEventListener("click", async function (event) {
    const button = event.target.closest("[data-revoke]");
    if (!button) return;
    const result = await HK.client.rpc("admin_revoke_user", { p_user_id: button.dataset.revoke });
    if (result.error) {
      showNotice("Could not remove admin access. The last owner cannot be removed.", "error");
      return;
    }
    await loadTeam();
  });

  document.getElementById("privacyRequestsList").addEventListener("click", async function (event) {
    const button = event.target.closest("[data-save-privacy]");
    if (!button) return;
    button.disabled = true;
    const id = button.dataset.savePrivacy;
    const status = document.querySelector('[data-privacy-status="' + id + '"]').value;
    const result = await HK.client.from("privacy_requests").update({ status: status }).eq("id", id);
    if (result.error) {
      showNotice("Could not update the privacy request: " + result.error.message, "error");
      button.disabled = false;
      return;
    }
    showNotice("Privacy request status updated.", "");
    await loadPrivacyRequests();
  });

  initialize().catch(function (error) {
    console.error("Admin access could not be checked:", error);
    showNotice("Admin access could not be checked. Refresh the page to try again.", "error");
  });
}());
