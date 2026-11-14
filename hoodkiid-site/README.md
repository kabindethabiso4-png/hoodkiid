# HOODKIID website

The existing [hoodkiid-storefront.html](../hoodkiid-storefront.html) remains the public storefront. The cart drawer creates real order requests when Supabase is configured. Account sign-in, customer profiles, order confirmation, privacy requests, and admin tools live in this folder.

## Pages

- `../hoodkiid-storefront.html` — original storefront, catalogue, and cart
- `../index.html` — website entry point, redirects to the original storefront
- `account.html` — shared sign-in and account creation
- `reviews.html` — customer product reviews, photo uploads, and like/dislike reactions
- `profile.html` — contact details, order history and unpaid-order editing, personal-data download, and account-deletion request
- `privacy.html` — POPIA privacy notice and rights information
- `order.html` — order reference, bank selection, and WhatsApp follow-up
- `admin.html` — analytics, signed-in customer carts, review moderation/replies, orders, payment verification, products/stock, bank accounts, pickup locations, privacy-request review, and owner-managed team access

## Supabase setup

1. Create a Supabase project if needed, then run the updated [`hoodkiid-database.sql`](../hoodkiid-database.sql) in its SQL editor. Re-run it on existing projects to install the unpaid-order editing function and its permissions. It configures customer profiles, order ownership, product reviews and voting, anonymous page-view counts, signed-in customer carts, the product/review image Storage buckets, and privacy-request policies. Existing orders are matched to accounts by email where possible. Existing products without images are hidden until an admin adds images.
2. Set the Supabase project URL, public anon/publishable key, and business WhatsApp number in `assets/js/config.js`. Never place a service-role key in browser code.
3. New sign-ups must include a name, surname, and WhatsApp number. A call number is optional.
4. Serve the workspace root (the folder containing both `hoodkiid-storefront.html` and `hoodkiid-site`) through a local static web server during development, then deploy that same structure to a static host. Configure `hoodkiid-site/account.html` as an allowed Supabase Auth redirect URL.
5. Open `account.html`, create your owner account, then assign it once in the Supabase SQL editor:

   ```sql
   insert into public.admin_users (user_id, role)
   select id, 'owner'
   from auth.users
   where lower(email) = lower('YOUR_OWNER_EMAIL')
   on conflict (user_id) do update set role = 'owner';
   ```

6. Once signed in as owner, grant admin access to existing user accounts from the **Team access** tab. Admin users do not have permission to grant additional admins.
7. Add products with one to five JPEG, PNG, WebP or GIF images (up to 8 MB each), size/colour stock, active bank accounts, and pickup locations in the admin dashboard. Enter one size and one colour per stock variant, then add each other size/colour combination separately with its own stock count. If a variant was entered with multiple values combined, set that variant's stock to zero and add the individual combinations with their correct stock counts. Products cannot be published without at least one image.
8. Customers sign in to submit a rating, written product review, and up to three JPEG, PNG or WebP photos (5 MB each). Reviews are pending until an admin approves them; admins can reply. Signed-in customers can like or dislike each published review, with one active reaction per customer.

## Order and payment rules

The database recalculates prices and locks/decrements stock when an order is created; browser-submitted prices are not trusted. Customers can edit sizes, colours, and quantities from their profile while an order is awaiting payment. The database restores the old stock and reserves the edited items atomically, recalculates prices, and returns delivery orders to `awaiting_quote` whenever a delivery fee needs to be confirmed again. Orders over R1,500 in Soshanguve or Pretoria qualify for free delivery. Pickup is free where an active location is configured. Other delivery orders remain `awaiting_quote` until an admin sets the fee, and shoppers are told to wait for the confirmed final total before paying.

The confirmation page provides a bank selector and the unique order reference to use for EFT. WhatsApp is only a way to contact the shop with that reference; it does not verify a payment. An admin must confirm funds in the bank and update the order/payment status. No card payments or automatic bank integrations are enabled.

Customers sign in through `account.html` and land on their profile. Their profile shows order history and lets them download an available copy of account, profile, order and newsletter data or submit an account-deletion request. Deletion requests appear in the admin privacy queue; an authorised person must verify and process each request, including checking any records that must be retained by law. A request is not an immediate self-service account deletion. Customers can only read their own profile and orders.

The storefront does not expose an Admin link. A signed-in user sees the admin workspace link on their profile only when an admin role has been assigned; the admin page also checks the role before showing its tools. The dashboard aggregates recorded page views without visitor names or contact information. Open carts can be identified only for signed-in customers; their cart record is removed when they clear or place their cart.

Sample products are shown only while Supabase is unconfigured. Real checkout and sign-in stay disabled until it is configured.
