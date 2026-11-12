(function () {
  "use strict";

  const summary = document.getElementById("orderSummary");
  const instructions = document.getElementById("paymentInstructions");
  const options = document.getElementById("paymentOptions");
  const bankSelect = document.getElementById("bankAccount");
  const bankDetails = document.getElementById("bankDetails");
  const whatsApp = document.getElementById("whatsappLink");
  let order = HK.readLastOrder();
  if (!order) {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("ref") || "";
    const subtotal = Number(params.get("subtotal"));
    const totalValue = params.get("total");
    const total = totalValue === "" || totalValue === null ? null : Number(totalValue);
    const status = params.get("status") || "";
    if (/^HK-\d{6}-[A-F0-9]{8}$/.test(reference) && Number.isFinite(subtotal) &&
        (total === null || Number.isFinite(total)) &&
        ["awaiting_quote", "awaiting_payment"].includes(status)) {
      order = { reference: reference, subtotal: subtotal, total: total, status: status };
    }
  }

  if (!order) {
    summary.innerHTML = "<p>We couldn't find order details in this browser session. If you have your reference, contact HOODKIID and we can help.</p>";
    return;
  }
  summary.innerHTML = "<h2>Reference</h2><p class=\"order-code\">" + HK.escapeHtml(order.reference) +
    "</p><p>Items subtotal: <strong>" + HK.money(order.subtotal) + "</strong></p><p>Order status: " +
    HK.escapeHtml(String(order.status).replaceAll("_", " ")) + "</p>";

  const phone = String(HK.config.whatsappPhone || "").replace(/\D/g, "");
  if (phone) {
    whatsApp.href = "https://wa.me/" + phone + "?text=" + encodeURIComponent("Hi HOODKIID, I placed order " + order.reference + ". Please confirm my order and payment details.");
    whatsApp.hidden = false;
  }
  if (order.status === "awaiting_quote" || order.total == null) {
    instructions.textContent = "We will confirm any delivery fee and your final total before you make payment. Please wait for our confirmation.";
    return;
  }

  instructions.textContent = "Final amount: " + HK.money(order.total) + ". Use your order reference exactly as the EFT payment reference. We verify funds in the bank before fulfilment.";
  options.hidden = false;
  if (!HK.client) {
    bankDetails.hidden = false;
    bankDetails.textContent = HK.databaseMessage();
    return;
  }
  HK.client.from("payment_accounts").select("id,bank_name,account_holder,account_number,branch_code,account_type")
    .eq("active", true).order("bank_name").then(function (result) {
      if (result.error) {
        bankDetails.hidden = false;
        bankDetails.textContent = "Payment details could not be loaded. Please contact HOODKIID before paying.";
        return;
      }
      const accounts = result.data || [];
      if (!accounts.length) {
        bankDetails.hidden = false;
        bankDetails.textContent = "Payment details are not available yet. Please contact HOODKIID before paying.";
        return;
      }
      bankSelect.innerHTML = accounts.map(function (account) {
        return '<option value="' + HK.escapeHtml(account.id) + '">' + HK.escapeHtml(account.bank_name) + "</option>";
      }).join("");
      function showAccount() {
        const account = accounts.find(function (item) { return item.id === bankSelect.value; });
        if (!account) return;
        bankDetails.hidden = false;
        bankDetails.innerHTML = "<strong>" + HK.escapeHtml(account.bank_name) + "</strong><br>Account holder: " +
          HK.escapeHtml(account.account_holder) + "<br>Account number: " + HK.escapeHtml(account.account_number) +
          (account.branch_code ? "<br>Branch code: " + HK.escapeHtml(account.branch_code) : "") +
          (account.account_type ? "<br>Account type: " + HK.escapeHtml(account.account_type) : "") +
          "<br>Payment reference: <strong>" + HK.escapeHtml(order.reference) + "</strong>";
      }
      bankSelect.addEventListener("change", showAccount);
      showAccount();
    }).catch(function () {
      bankDetails.hidden = false;
      bankDetails.textContent = "Payment details could not be loaded. Please contact HOODKIID before paying.";
    });
}());
