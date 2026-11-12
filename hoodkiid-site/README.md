# HOODKIID website

The existing [hoodkiid-storefront.html](../hoodkiid-storefront.html) remains the public storefront and keeps its original visual design. The cart drawer now creates real order requests when Supabase is configured. Separate account, order confirmation, and admin pages live in this folder.

## Pages

- `../hoodkiid-storefront.html` — original storefront, catalogue, and cart
- `../index.html` — website entry point, redirects to the original storefront
- `account.html` — shared customer/team sign-in and account creation
- `order.html` — order reference, bank selection, and WhatsApp follow-up
- `admin.html` — orders, payment verification, delivery fees, products/stock, bank accounts, pickup locations, and owner-managed team access

## Supabase setup

1. Create a Supabase project if needed, then run the updated [`hoodkiid-database.sql`](../hoodkiid-database.sql) in its SQL editor (rerun it on an existing project to add customer profiles and order ownership). Existing orders are matched to accounts by email where possible.
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
7. Add products with size/colour stock, active bank accounts, and pickup locations in the admin dashboard.

## Order and payment rules

The database recalculates prices and locks/decrements stock when an order is created; browser-submitted prices are not trusted. Orders over R1,500 in Soshanguve or Pretoria qualify for free delivery. Pickup is free where an active location is configured. Other delivery orders remain `awaiting_quote` until an admin sets the fee, and shoppers are told to wait for the confirmed final total before paying.

The confirmation page provides a bank selector and the unique order reference to use for EFT. WhatsApp is only a way to contact the shop with that reference; it does not verify a payment. An admin must confirm funds in the bank and update the order/payment status. No card payments or automatic bank integrations are enabled.

Customers must sign in and complete their contact profile before checkout. Their account shows active orders and the latest status/payment updates. All assigned admins share the same order queue and can update any order; customers can only read orders belonging to their account.

Sample products are shown only while Supabase is unconfigured. Real checkout and sign-in stay disabled until it is configured.
