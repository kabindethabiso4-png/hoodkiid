(function () {
  "use strict";

  const form = document.getElementById("reviewForm");
  const productSelect = document.getElementById("reviewProduct");
  const fileInput = document.getElementById("reviewImages");
  const message = document.getElementById("reviewMessage");
  const reviewList = document.getElementById("publicReviews");
  const imageBucket = "product-review-images";
  const maxImages = 3;
  const maxImageBytes = 5 * 1024 * 1024;
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  let session = null;

  function imageUrls(images) {
    const base = String(HK.config.supabaseUrl || "").replace(/\/$/, "");
    return images.map(function (image) {
      return HK.client.storage.from(imageBucket).getPublicUrl(image.path).data.publicUrl;
    }).filter(function (url) {
      return base && url.indexOf(base + "/storage/v1/object/public/" + imageBucket + "/") === 0;
    });
  }

  function validateImages(files) {
    if (files.length > maxImages) throw new Error("Choose no more than three photos.");
    files.forEach(function (file) {
      if (!allowedTypes.includes(file.type)) throw new Error("Use JPEG, PNG or WebP images.");
      if (file.size === 0 || file.size > maxImageBytes) throw new Error("Each photo must be non-empty and no larger than 5 MB.");
    });
  }

  async function uploadImages(files) {
    validateImages(files);
    const uploaded = [];
    const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    for (const file of files) {
      const suffix = window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : Date.now() + "-" + Math.random().toString(36).slice(2);
      const path = session.user.id + "/" + suffix + "." + extensions[file.type];
      const result = await HK.client.storage.from(imageBucket).upload(path, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false
      });
      if (result.error) {
        if (uploaded.length) {
          const cleanup = await HK.client.storage.from(imageBucket).remove(uploaded.map(function (image) { return image.path; }));
          if (cleanup.error) console.error("Could not clean up incomplete review image upload:", cleanup.error);
        }
        throw result.error;
      }
      uploaded.push({ path: path });
    }
    return uploaded;
  }

  async function loadProducts() {
    const result = await HK.client.from("products").select("id,name").eq("active", true).order("name");
    if (result.error) throw result.error;
    productSelect.innerHTML = (result.data || []).map(function (product) {
      return '<option value="' + HK.escapeHtml(product.id) + '">' + HK.escapeHtml(product.name) + "</option>";
    }).join("");
    if (!result.data || !result.data.length) {
      productSelect.innerHTML = '<option value="">No products are currently available</option>';
      form.querySelector('button[type="submit"]').disabled = true;
    }
  }

  async function loadReviews() {
    reviewList.innerHTML = "<p>Loading customer reviews…</p>";
    const result = await HK.client.rpc("list_public_product_reviews");
    if (result.error) throw result.error;
    const reviews = result.data || [];
    reviewList.innerHTML = reviews.length ? reviews.map(function (review) {
      const images = (review.image_urls || []).filter(function (url) {
        const base = String(HK.config.supabaseUrl || "").replace(/\/$/, "");
        return base && typeof url === "string" && url.indexOf(base + "/storage/v1/object/public/" + imageBucket + "/") === 0;
      }).map(function (url) {
        return '<img src="' + HK.escapeHtml(url) + '" alt="Customer photo for ' + HK.escapeHtml(review.product_name) + '" loading="lazy">';
      }).join("");
      return '<article class="public-review"><header><div><h3>' + HK.escapeHtml(review.product_name) + '</h3><p class="review-byline">' +
        HK.escapeHtml(review.customer_name) + ' · ' + HK.escapeHtml(new Date(review.created_at).toLocaleDateString("en-ZA")) +
        '</p></div><strong aria-label="' + review.rating + ' out of 5 stars">' + "★".repeat(review.rating) + "☆".repeat(5 - review.rating) +
        '</strong></header><p>' + HK.escapeHtml(review.review_text) + '</p>' +
        (images ? '<div class="review-images">' + images + "</div>" : "") +
        (review.admin_reply ? '<div class="admin-reply"><strong>HOODKIID replied</strong><p>' + HK.escapeHtml(review.admin_reply) + "</p></div>" : "") +
        '<div class="review-votes"><button class="button button-light" type="button" data-review-vote="like" data-review-id="' + HK.escapeHtml(review.id) +
        '">Like · ' + Number(review.like_count || 0) + '</button><button class="button button-light" type="button" data-review-vote="dislike" data-review-id="' +
        HK.escapeHtml(review.id) + '">Dislike · ' + Number(review.dislike_count || 0) + "</button></div></article>";
    }).join("") : "<p>No approved reviews yet. Be the first to share your experience.</p>";
  }

  async function initialize() {
    const unavailable = HK.databaseMessage();
    if (unavailable) {
      HK.setMessage(message, unavailable, "error");
      HK.setMessage(document.getElementById("reviewSignInMessage"), unavailable, "error");
      return;
    }
    const authResult = await HK.client.auth.getSession();
    if (authResult.error) throw authResult.error;
    session = authResult.data.session;
    if (session) {
      form.hidden = false;
      await loadProducts();
    } else {
      document.getElementById("reviewSignInMessage").hidden = false;
    }
    await loadReviews();
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!session) {
      HK.setMessage(message, "Sign in before submitting a review.", "error");
      return;
    }
    const button = document.getElementById("submitReview");
    const files = Array.from(fileInput.files || []);
    let uploaded = [];
    button.disabled = true;
    try {
      validateImages(files);
      uploaded = await uploadImages(files);
      const result = await HK.client.from("product_reviews").insert({
        product_id: productSelect.value,
        customer_id: session.user.id,
        rating: Number(document.getElementById("reviewRating").value),
        review_text: document.getElementById("reviewText").value.trim(),
        image_urls: imageUrls(uploaded),
        status: "pending"
      });
      if (result.error) throw result.error;
      form.reset();
      HK.setMessage(message, "Thanks for sharing. Your review is awaiting admin approval.", "");
    } catch (error) {
      if (uploaded.length) {
        const cleanup = await HK.client.storage.from(imageBucket).remove(uploaded.map(function (image) { return image.path; }));
        if (cleanup.error) console.error("Could not remove images after a failed review submission:", cleanup.error);
      }
      console.error("Review submission failed:", error);
      HK.setMessage(message, "Could not submit your review. Please check your photos and try again.", "error");
    } finally {
      button.disabled = false;
    }
  });

  reviewList.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-review-vote]");
    if (!button) return;
    if (!session) {
      window.location.assign("account.html?next=review");
      return;
    }
    button.disabled = true;
    const result = await HK.client.rpc("vote_product_review", {
      p_review_id: button.dataset.reviewId,
      p_vote: button.dataset.reviewVote
    });
    if (result.error) {
      console.error("Review vote failed:", result.error);
      HK.setMessage(message, "Could not record your reaction. Please try again.", "error");
      button.disabled = false;
      return;
    }
    try {
      await loadReviews();
    } catch (error) {
      console.error("Could not refresh reviews:", error);
      HK.setMessage(message, "Your reaction was saved, but reviews could not be refreshed.", "error");
    }
  });

  initialize().catch(function (error) {
    console.error("Reviews page could not be loaded:", error);
    HK.setMessage(message, "Reviews could not be loaded. Please refresh and try again.", "error");
    reviewList.innerHTML = "<p>Reviews are temporarily unavailable.</p>";
  });
}());
