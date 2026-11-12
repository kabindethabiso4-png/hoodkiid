(function () {
  "use strict";

  const CART_KEY = "hoodkiid.cart.v1";
  const ORDER_KEY = "hoodkiid.last-order.v1";
  const config = window.HOODKIID_CONFIG || {};
  let client = null;

  if (config.supabaseUrl && config.supabaseAnonKey && window.supabase && window.supabase.createClient) {
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  }

  function readCart() {
    try {
      const value = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (!Array.isArray(value)) return [];
      return value.filter(function (line) {
        return line && typeof line.productId === "string" && typeof line.variantId === "string" &&
          Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 20;
      });
    } catch (error) {
      return [];
    }
  }

  function writeCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartCount();
  }

  function updateCartCount() {
    const count = readCart().reduce(function (sum, line) { return sum + line.quantity; }, 0);
    document.querySelectorAll("[data-cart-count]").forEach(function (node) { node.textContent = String(count); });
  }

  function money(amount) {
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(amount) || 0);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function setMessage(node, text, tone) {
    if (!node) return;
    node.textContent = text;
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
  }

  function saveLastOrder(order) {
    sessionStorage.setItem(ORDER_KEY, JSON.stringify(order));
  }

  function readLastOrder() {
    try {
      const order = JSON.parse(sessionStorage.getItem(ORDER_KEY) || "null");
      return order && typeof order.reference === "string" ? order : null;
    } catch (error) {
      return null;
    }
  }

  function databaseMessage() {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      return "The store is not connected to its order system yet. Please check back soon.";
    }
    if (!client) return "The order service could not load. Check your connection and try again.";
    return "";
  }

  document.querySelectorAll("[data-year]").forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });
  updateCartCount();

  window.HK = {
    client: client,
    config: config,
    readCart: readCart,
    writeCart: writeCart,
    updateCartCount: updateCartCount,
    money: money,
    escapeHtml: escapeHtml,
    setMessage: setMessage,
    saveLastOrder: saveLastOrder,
    readLastOrder: readLastOrder,
    databaseMessage: databaseMessage
  };
}());
