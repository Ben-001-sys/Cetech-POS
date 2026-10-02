# CETECH POS — Staff Training & User Guide

**Updated for this testing round:** 2 October 2026 — price-check instructions revised.

**Read and understand the [current Test Brief](https://github.com/WB-DevWorld/cetech-pwa-pos/tree/ws3/quote-latency-2026-10-02/docs/staff/testing-2026-10-02/brief) first.**

**[Open the POS for this round](https://cetech-pos-staging-git-integration-9578df-wbdevworlds-projects.vercel.app)**

Use this same address when opening or installing the POS. If your installed POS already uses it and works, keep using it and preserve your saved work.

**Audience:** Cashiers, managers, owners/admins, and authorized support staff  
**Language:** Plain operational English  
**Purpose:** Teach staff how to use the POS safely during normal work  
**Important:** This guide describes intended behavior for the build being tested. The exact test build must be recorded in the Test Brief.

---

## 1. What CETECH POS is for

CETECH POS is the system staff use at the counter to:

1. sign in;
2. open or continue a register shift;
3. find or scan products;
4. choose a customer when needed;
5. confirm the price;
6. take payment;
7. complete the sale;
8. print or reprint a receipt;
9. find previous orders;
10. process returns;
11. close the shift when authorized.

The basic selling idea is:

**Scan → Sell → Pay → Print**

The system may do complicated work in the background, but ordinary staff should see simple retail language.

---

## 2. Roles — what different people can do

### Cashier

A cashier normally works with:

- Sell
- Orders
- Customers
- Returns
- Register
- Attention
- Settings
- System status when needed

A cashier should **not** need raw technical details, database IDs, API names, build numbers, provider names, or developer terminology to serve a customer.

### Manager

A manager can do cashier work and may also have a **Management** area for locations they manage.

Depending on the rules configured for the location, a manager may be able to:

- review shifts and cash;
- close shifts;
- review cash differences;
- approve a return when manager approval is required;
- check an unresolved refund;
- update register assignments for staff already assigned to a managed location;
- view operational rules;
- view receipt settings;
- view System status and the activity log.

### Owner / Admin

Owner/Admin access is organization-level control.

An Admin may also sell, but needs a separate Cashier or Manager assignment at the location and an assigned register. Admin alone does not grant every shift or return-approval permission.

Depending on the exact authorization, they can manage:

- staff accounts;
- POS access;
- organization roles;
- cashier/manager assignments;
- locations;
- registers;
- devices;
- operational rules;
- receipt settings;
- management diagnostics;
- activity/audit history.

### Support

Support access is for diagnostics and audit where authorized. Support access does not automatically give cashier, manager, refund, cash, or organization-control authority.

---

# PART A — CASHIER TRAINING

## 3. Signing in

1. Open CETECH POS from the current Test Brief link above.
2. Enter your **staff email**.
3. Enter your **password**.
4. Select **Sign in**.

If your temporary password must be changed, the POS will show **Choose a new password** before opening the rest of the POS.

If you see:

- **Session expired** — sign in again. Your safe local cart should remain available.
- **Access denied** — open the POS link in the current Test Brief first. If it still fails, ask a manager to check your access. Record the website address, the message, and any Reference line. This message can also appear when a different POS address is not accepted; it does not always mean your password is wrong.
- **Register locked** — sign in to continue the existing shift.
- **Sign-in unavailable** — try again. A **Reference** line under that notice is a support id. Read it to a manager. It is not a password.

A wrong email or password stays **Incorrect email or password.** That message does not add a Reference line.

Disabled POS access stays **Your POS access is disabled. Contact a manager.** That message does not add a Reference line.

Do not use another staff member's login.

---

## 4. Main navigation

The normal POS navigation contains the main work areas:

- **Sell** — create and complete a sale.
- **Orders** — find completed/recent sales, reprint receipts, and start returns.
- **Customers** — find a customer to use for a sale.
- **Returns** — review and complete return workflows.
- **Register** — open, view, and close a shift when permitted.
- **Attention** — work that needs review or recovery.
- **Settings** — device/register information, appearance, and System status.

Management functions are separate and should only appear to people who are authorized.

---

## 5. Opening the register / starting a shift

Before taking payment, the POS needs an open shift.

1. Open **Register**.
2. Choose the correct **Register** if more than one is available.
3. Choose the correct **POS device** when asked.
4. Enter the **opening cash** actually placed in the drawer.
5. Select **Open register**.

Important:

- Opening a register requires a connection.
- Only active devices assigned to the correct location can be used.
- Do not choose a different register just to bypass an error.
- If the system says the register/device is unavailable, ask a manager.

Once open, Register shows the working register and shift status.

Only one open or closing shift is allowed on a register at a time. People who need independent shifts need separate registers, even when they have separate accounts. Each register's location must have an active POS device.

---

## 6. Finding products

On **Sell**, you can normally find a product by:

- scanning its barcode;
- typing its name;
- typing its SKU or another supported identifier.

### Barcode scanner

For a keyboard-style barcode scanner:

1. click/focus the normal selling screen if needed;
2. scan the product;
3. wait for the product to appear in the cart or for the POS to ask you to choose a variation.

Do not manually shorten or rename product data because a product name is long. Compact POS screens may visually show only part of a long name, but the underlying product name remains complete.

---

## 7. Product variations

If a product has choices such as size, colour, specification, or another variation:

1. choose the correct variation;
2. confirm the variation shown in the cart;
3. verify the price before taking payment.

If you are not sure which variation the customer wants, do not guess.

---

## 8. Working with the cart

In the cart you can normally:

- add products;
- change quantity;
- remove products;
- see Subtotal, Discount, Tax, and Total;
- clear/discard a sale when safe.

The cart should show the current working sale only.

A completed cart should no longer remain as an ordinary active cart. Do not clear browser/site storage to fix a cart-count problem; report it.

---

## 9. Choosing a customer

The safe default is **Walk-in**.

Use **Customers** or the customer picker on Sell when you need to attach a known customer.

Customers may be:

- Walk-in;
- Retail;
- Wholesale.

For a wholesale customer, the POS must obtain the proper authoritative price. Staff should not manually recreate wholesale pricing rules.

After selecting a customer, verify the customer shown before payment.

---

## 10. Price status

Before payment, the POS may show that the price is being checked.

The cashier-friendly successful state is:

**Price ready**

If price information needs to be checked again, follow the message shown by the POS.

If the POS shows **Check price again**, select it once. It checks the same cart; it does not make a payment or create another sale. Keep the products and quantities as they are while the check finishes. Pay stays unavailable until the price is ready.

If the check fails again or stays on **Updating price…**, record how long you waited and take a screenshot. Continue a different test while the problem is investigated. Do not clear saved POS work or make up a replacement price.

Do not manually calculate a replacement total when the POS says the price is unavailable.

---

## 11. Starting payment

Select **Pay** only when:

- the correct products are in the cart;
- the correct quantities are shown;
- the correct customer is selected;
- the price is ready;
- the correct register/shift is open.

The available payment methods depend on what is configured for that test/location.

Possible methods can include:

- Cash
- Mobile Money
- Card
- External terminal

A payment method should not appear as usable merely because a provider account exists. It must be enabled and verified for that environment.

---

## 12. Cash payment

For cash:

1. choose **Cash**;
2. enter the amount received if the POS asks;
3. verify the amount;
4. confirm the cash payment once.

Do not press the confirmation button repeatedly because the screen is slow.

If the POS becomes uncertain after payment, keep the current sale and follow the on-screen recovery message.

If Pay does not reach payment, keep the same cart. A sale that was not sent can be tried again on that same cart. A sale that was not created can be retried or cleared only after that attempt is finished. If the POS cannot prove whether the sale was created, it keeps that same attempt for a manager. It shows **This needs manual review. Contact a manager or support.** If the register says an existing order cannot yet be opened for payment, leave that order as it is and ask a manager. Do not start another sale for that cart. If the screen says payment was already submitted, do not charge again. If the sale is complete but the official receipt is not on this register, contact a manager and do not take payment again. Do not start a second sale for that attempt, and do not clear the browser's saved data to repair it.

---

## 13. Electronic payment

Only test/use an electronic method that the test coordinator has explicitly enabled.

If the POS says:

**Payment is still being checked. Do not charge again.**

do exactly that.

Do not:

- start a second payment;
- use a different payment reference for the same sale;
- create another sale to “try again”.

Use **Attention** or ask a manager when the payment remains unresolved.

---

## 14. Sale completed

A sale is complete only after the POS confirms completion.

After completion:

- the completed cart is retired from the active selling workspace;
- a new clean selling workspace becomes available;
- the receipt remains printable/reprintable independently;
- the completed sale should appear in Orders.

If the old completed sale remains active or appears as a saved active cart, report it.

---

## 15. Receipts

The customer receipt should use customer-friendly information.

It may include:

- receipt/order reference;
- understandable date and time;
- product/variation description;
- quantity;
- prices/tax/total;
- payment method;
- optional SKU where configured.

Receipt product-name shortening is a **receipt presentation setting**. It must not change the actual product name in the catalog.

Technical details should not be prominent on the customer receipt.

### Printing

Select **Print receipt**.

The browser print preview should show the receipt itself, not a blank page and not the entire POS interface.

If printing fails:

- do not repeat the sale;
- reprint from the completed sale/order;
- report the print problem separately.

---

## 16. Orders

Open **Orders** to:

- search recent sales;
- search by order, receipt, customer, or transaction reference;
- filter by status;
- open order details;
- reprint a receipt;
- start a return when allowed.

Order dates should be shown in understandable local operational format, not raw computer timestamps.

---

## 17. Customers

Open **Customers** to search by:

- name;
- company;
- phone.

Select **Use for next sale** to carry that customer into the next sale.

If customer search is temporarily unavailable, Walk-in remains the safe fallback unless the sale specifically requires a known customer/wholesale account.

---

## 18. Returns

A normal return flow can ask you to:

1. select the sale/order;
2. select the item(s);
3. select quantity;
4. enter a reason;
5. select the item condition;
6. select **Review return**;
7. check the summary;
8. select **Complete return**.

Possible conditions can include:

- Resellable — unopened
- Resellable — opened
- Damaged
- Defective
- Quarantine
- Not physically returned

### What “needs attention” means

A return can involve separate work such as:

- the customer's money;
- the order refund;
- the stock update.

These parts may finish at different times. The POS may therefore show one part as completed while another part still needs checking.

Examples you may see:

- **Cash refund already completed** — do **not** refund the customer again.
- **Order refund needs review** — do **not** create another order refund for the same return.
- **Stock update is not settled yet** — do **not** manually adjust the stock while this return is still being checked.

If part of the return is not safely confirmed, the POS may lock the same return and show that it **needs attention**.

This does **not** mean “start another return”.

Use **Check return status** or **Attention** to review the existing return. If your role cannot resolve it, leave that existing return in place for an authorized manager/support user.

---

## 19. Attention

Attention contains work that needs checking rather than repeating.

Examples:

- payment still being checked;
- sale completion uncertain;
- refund needs confirmation;
- return needs manager review.

The important rule is:

**Resolve the existing work. Do not create a second copy of the same transaction.**

---

## 20. Register and ending a shift

When shift closing is allowed for your role:

1. open **Register**;
2. count the physical drawer cash;
3. enter **what you actually counted**;
4. select **End shift**.

The POS intentionally does not reveal expected cash before you submit the count.

After completion it can show:

- Counted;
- Expected;
- Variance;
- End-of-shift report (Z report).

If the variance requires manager review, do not change the physical count to make it match.

---

## 21. Settings

Cashier Settings shows operational information such as:

- device;
- register;
- scanner capability;
- printer capability;
- theme/appearance;
- link to **System status**.

It should not expose ordinary cashiers to raw build IDs, database/schema details, provider internals, or repair controls.

---

## 22. System status

System status tells staff whether important services are available.

Use it when something appears unavailable.

Cashier-facing System status should explain what is working or unavailable in ordinary language.

Detailed engineering/support information belongs in Management/support views.

---

# PART B — OFFLINE USE

## 23. What should remain usable offline

When a previously verified device/session loses connectivity, the POS should keep the safe local working experience available where possible.

Expected safe offline behavior can include:

- the real POS shell remains visible;
- last verified staff/register presentation remains visible while still valid;
- locally stored product information can remain searchable;
- the current cart/draft remains available;
- the POS clearly says connection is unavailable.

---

## 24. What should stay blocked offline

Offline presentation is **not** fresh commercial authority.

Depending on the current build, the following server-authoritative actions should remain blocked until connection returns:

- fresh authoritative pricing;
- Pay/checkout;
- starting a new electronic payment;
- Returns execution/resolve;
- Attention recovery actions;
- register-changing actions;
- other actions that require server confirmation.

The POS should tell you that a connection is required instead of pretending the operation succeeded.

---

## 25. Reconnecting

When connection returns:

1. allow the POS a moment to re-establish the server session;
2. confirm the current cart is still present;
3. confirm normal pricing/payment/register authority returns;
4. do not create a replacement cart or duplicate transaction merely because the system was offline.

Never clear browser site data, IndexedDB, or caches as a routine cashier fix.

---

# PART C — MANAGER / OWNER / ADMIN TRAINING

## 26. Opening Management

Authorized users can enter a separate **Management** area.

Management is intentionally separate from normal cashier navigation.

Typical sections are:

- Overview
- Staff & access
- Locations
- Registers
- Devices
- Shifts & cash
- Returns & approvals
- System status
- Activity log
- Operational rules
- Receipt settings

What you see depends on your role.

---

## 27. Staff & access

Owner/Admin can manage organization staff access.

### Create account now

1. open **Management → Staff & access**;
2. select **Create account now**;
3. enter Name and Email;
4. create/generate a temporary password;
5. choose any organization role if required;
6. choose location role (Cashier or Manager);
7. choose register assignment;
8. choose whether POS access should be turned on after setup succeeds;
9. select **Create account**.

The staff member must change the temporary password at first sign-in.

### Send invitation

Choose **Send invitation** to email a secure account-setup link.

Invited staff cannot use the POS until their assignments are completed and POS access is enabled.

### POS access

Disabling POS access:

- blocks new POS sign-in;
- signs the person out of active POS sessions.

Do not disable your own access casually.

---

## 28. Organization roles

Organization control roles are different from cashier/manager location roles.

Organization roles:

- Owner
- Admin
- Support

Operational location roles:

- Cashier
- Manager

Do not treat “Admin” and “Manager” as the same thing.

At least one active Owner must remain.

---

## 29. Locations

Owner/Admin can add or update locations.

Locations are normally deactivated rather than deleted.

Use meaningful names staff will recognize.

---

## 30. Registers

Owner/Admin can add or update registers.

A register has:

- a location;
- a name;
- a currency;
- a status.

The currency/location relationship is intentionally controlled. Do not casually recreate a register just to change configuration.

A register may be unable to open a shift if its location has no active POS device.

---

## 31. Devices

Owner/Admin can add or manage POS devices by location.

A device is assigned to a location and can be Active or Inactive.

Do not use made-up device IDs or browser-generated IDs as operational device authority.

---

## 32. Shifts & cash

Management can review shift/cash information inside authorized scope.

Depending on role and policy, managers can:

- view open/closed shifts;
- view the X report/current shift summary;
- view the durable Z report after close;
- close shifts;
- review cash differences;
- reverse an incorrect cash movement through the controlled correction flow.

A cash correction is an exact reversal of an existing cash entry. Do not edit historical cash entries directly.

---

## 33. Returns & approvals

Management can see returns/refunds that need attention.

Possible actions can include:

- **Approve return** — records manager approval for the same return;
- **Check refund** — checks the existing refund/reconciliation state.

Approval does not itself create a new refund or change stock.

A manager should never create a second refund merely because an existing one is awaiting confirmation.

---

## 34. Operational rules

Operational rules can control things such as:

- whether cashiers can close shifts;
- whether managers can close shifts;
- whether cashiers can close only their own shift;
- whether cash differences require manager review;
- whether returns require manager approval.

Rules can be applied at organization, location, or register level.

More specific rules can override broader defaults.

---

## 35. Receipt settings

Receipt settings are configured per location.

Owner/Admin can control:

- **Shorten product names on receipts**;
- **Maximum product-name characters**;
- **Show SKU on receipts**.

These settings affect future receipts. They do not change the catalog product name.

Managers may have read-only visibility depending on authorization.

---

## 36. Management System status

Management System status can show more diagnostic information than cashier System status.

It may include a collapsible **Technical detail** or Reference section.

Technical detail is for authorized management/support use. It should not be necessary for a cashier to finish an ordinary sale.

---

## 37. Activity log

The activity log records authorized management changes, such as who changed what and where.

Use it for:

- administration review;
- audit;
- support;
- investigating unexpected configuration changes.

Do not treat the activity log as a substitute for normal cashier instructions.

---

# PART D — SAFE OPERATION RULES

## 38. Never do these

Do not:

- press payment confirmation repeatedly;
- create a second payment while the first is still being checked;
- create a second return to work around an unresolved one;
- manually alter prices to imitate wholesale rules;
- clear browser/site data to fix a POS problem;
- share staff passwords;
- use another person's account;
- switch registers to bypass authorization;
- assume a printed receipt failure means the sale failed;
- manually repeat a completed cash/refund effect because the screen looks uncertain.

---

## 39. When to ask a manager

Ask a manager when:

- your account does not have access to the correct register;
- a return needs approval;
- a shift/cash difference requires review;
- a refund remains unresolved;
- the POS says work needs attention and you do not have permission to resolve it.

---

## 40. When to report a software problem

Report a problem when:

- a button does not do what the screen says;
- a completed sale remains in the active cart;
- a receipt preview is blank or prints the whole POS;
- an understandable date/time is not shown;
- the POS exposes raw technical details to a cashier;
- going offline makes the POS disappear or incorrectly signs out a previously verified staff session;
- a cart/product disappears after reconnect;
- a count/status is clearly inconsistent with what you did;
- the same action appears to create duplicate orders/payments/returns;
- a role can see or do something it should not.

Use the Testing Workbook format so the problem can be reproduced.
