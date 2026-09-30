# CETECH POS — Staff Testing & Acceptance Workbook

**Purpose:** Help staff test the POS systematically, not randomly.  
**Audience:** Cashiers, managers, owners/admins, and authorized support testers.  
**Rule:** Test the exact build recorded in the Test Brief. Do not mix results from different builds.

---

## 1. How to record every test

Make your own copy of this workbook and write your results in it.

For every test you perform, add this result block underneath that test:

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

At the top of your completed workbook, also record:

- Tester name:
- Date/time:
- Device:
- Browser / installed PWA:
- Test role:
- Test version/build shown in the Test Brief:

### Screenshots and photos

If the screen shows something important, unusual, confusing, or wrong, capture it where relevant.

You may either:

- embed the image directly in this Markdown file; or
- save it separately and write the exact filename/path in the result block.

Recommended screenshot folder:

`screenshots/`

Recommended filename format:

`<TEST-ID>-<short-description>-<number>.png`

Examples:

- `screenshots/T40-cash-sale-01.png`
- `screenshots/T61-blank-print-preview-01.png`
- `screenshots/T102-offline-reopen-01.png`

If you embed an image in Markdown, use the normal Markdown image format and point it to the exact screenshot file you submit.

Keep the screenshot filename/path unchanged after you reference it.

### What to submit

Save your completed workbook using:

`POS-Test-Results-YourName-2026-09-24.md`

Save screenshots in a folder such as:

`POS-Test-Screenshots-YourName-2026-09-24/`

Then submit:

1. the completed Testing Workbook; and
2. the entire screenshot/photo folder containing every file referenced in the workbook.

Example:

- Workbook: `POS-Test-Results-Ama-2026-09-24.md`
- Screenshot: `POS-Test-Screenshots-Ama-2026-09-24/T61-blank-print-preview-01.png`

If you embed screenshots directly in the Markdown file, keep the referenced image files with the document so the images still open.

### A PASS means

The steps completed and the result matched the expected behavior.

### A FAIL means

The result did not match the expected behavior.

### PARTLY WORKED means

Some of the expected result worked, but something important was wrong.

### COULD NOT TEST means

The test was blocked by environment, access, configuration, hardware, or another known issue.

Do not mark a blocked test as PASS.

---

# A. BASIC ACCESS

## T01 — Normal staff sign-in

**Do:** Sign in with an authorized cashier account.

**Expected:**
- sign-in succeeds;
- normal POS appears;
- correct staff identity is shown;
- only authorized work areas are available.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T02 — Wrong password

**Do:** Enter a wrong password once.

**Expected:**
- sign-in is rejected;
- message is understandable;
- the main message stays the ordinary wrong-password wording and does not add a Reference line;
- no technical/server error is shown as the main message;
- no account access is granted.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T03 — Temporary password change

**Do:** Use a test account that must change its temporary password.

**Expected:**
- normal POS remains closed until password is changed;
- the user can set and confirm a new password;
- after success, normal authorized POS access becomes available.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T04 — Cashier cannot enter Management

**Do:** Use a cashier-only account and try the normal UI/direct Management route if your test setup allows it.

**Expected:**
- Management controls are not shown to the cashier;
- direct unauthorized access fails closed.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# B. REGISTER / SHIFT

## T10 — Open assigned register

**Do:**
1. Open Register.
2. Select an assigned register.
3. Select the correct active device if asked.
4. Enter the test opening cash.
5. Open register.

**Expected:**
- one shift opens;
- correct register/location/device is shown;
- no duplicate shift is created.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T11 — No active device

**Do:** Use a test register/location with no active device, only if that test setup is available.

**Expected:**
- shift cannot open;
- message clearly explains that an active POS device is required.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T12 — Register outside staff assignment

**Do:** Attempt an out-of-scope register only if a safe out-of-scope test account/setup is available.

**Expected:**
- access is refused;
- staff is not locked out of their valid register;
- valid register remains selectable.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T13 — Cashier register access without organization Admin

**Do:** With a test account assigned Cashier at a location and assigned at least one register, sign in on a desktop and a phone. Confirm the account has no organization Owner/Admin/Support role. Open Register without opening a shift.

**Expected:**
- the assigned register choices appear on both devices;
- no organization Admin role is needed;
- registers outside the account's assignments are absent;
- record the exact test URL/build on each device.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T14 — Register assignment changes during a session

**Do:** In a controlled staging test, have an authorized manager add or remove a test register assignment for the signed-in cashier. Record the visible register choices before the change. Return to the POS tab or reconnect, then open Register and record the choices afterward. Do not open a shift for this check.

**Expected:**
- the list reflects the current assignment without granting an organization Admin role;
- a removed register can no longer be selected;
- if the session or assignment check fails, the POS asks for recovery instead of saying the cashier has no assigned register;
- no saved cart or pending work is cleared.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# C. PRODUCTS / CART

## T20 — Search product by name

**Do:** Search for a known staging product.

**Expected:**
- correct product appears quickly;
- name/price presentation is readable.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T21 — Long product name

**Do:** Find a product with a very long name.

**Expected:**
- compact screen layout remains usable;
- name is visually limited where appropriate;
- full product identity is not changed in the data/search behavior.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T22 — Barcode scan

**Do:** Scan a known test barcode.

**Expected:**
- correct product/variation is found;
- scan does not add the wrong product.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T23 — Quantity change

**Do:** Add an item, increase/decrease quantity, then remove it.

**Expected:**
- quantity changes correctly;
- totals respond appropriately;
- removing the line removes it from the working cart.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T24 — Completed cart lifecycle

**Do:** Complete a safe staging sale.

**Expected:**
- completed sale is no longer the active working cart;
- a new clean selling workspace is available;
- completed cart is not counted as another active/saved working cart;
- receipt remains available separately.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# D. CUSTOMERS / PRICING

## T30 — Walk-in sale

**Do:** Prepare a normal walk-in sale.

**Expected:**
- Walk-in works without selecting a customer account.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T31 — Retail customer

**Do:** Search and select a known retail test customer.

**Expected:**
- correct customer is selected;
- the selection carries to the sale.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T32 — Wholesale customer

**Do:** Select an approved B2B/wholesale test customer.

**Expected:**
- Wholesale is shown;
- authoritative price is returned;
- cashier is not asked to manually calculate wholesale pricing.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T33 — Customer search unavailable

**Do:** Only if an unavailable-customer-search test condition is available.

**Expected:**
- message is understandable;
- Walk-in remains available where safe;
- no fake customer data appears.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# E. CASH SALE

## T40 — Normal cash sale

**Do:**
1. add product;
2. confirm customer;
3. wait for Price ready;
4. Pay;
5. choose Cash;
6. confirm once.

**Expected:**
- exactly one sale/order is completed;
- correct total is recorded;
- receipt is created;
- sale appears in Orders.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T41 — Double-click / repeated cash confirmation

**Do:** Only in the test environment. Attempt the same confirmation twice or repeat after a slow response.

**Expected:**
- no duplicate order;
- no duplicate cash payment;
- existing transaction is reused/resolved.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T42 — Slow/uncertain completion

**Do:** When a controlled test produces uncertainty.

**Expected:**
- POS keeps the same transaction;
- message tells staff what to do;
- no instruction to charge again;
- recovery checks the existing transaction;
- if the sale was not created, the cart stays and another Pay starts only after that attempt is cleared;
- if the result is still unknown, the message is **This needs manual review. Contact a manager or support.** and Pay does not start a second sale;
- if the register says an existing order cannot yet be opened for payment, staff leave that order and ask a manager instead of starting another sale;
- if payment was already submitted, staff do not charge again;
- if the sale is complete but the official receipt is missing, staff contact a manager and do not take payment again.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# F. ELECTRONIC PAYMENT

Only run these tests when the payment method is available in the test POS.

## T50 — Method availability

**Expected:**
- only configured methods are shown as available;
- Mobile Money and Card are independently enabled;
- a provider credential alone does not make a method appear usable.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T51 — Pending electronic payment

**Expected:**
- POS clearly says payment is still being checked;
- **Do not charge again** is visible;
- starting a duplicate payment is prevented.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# G. RECEIPTS / PRINTING

## T60 — Completed-sale receipt

**Do:** Complete a staging sale and view the receipt.

**Expected:**
- receipt has understandable date/time;
- product/variation text is readable;
- totals are correct;
- no prominent raw technical/debug block appears on the customer receipt.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T61 — Print receipt

**Do:** Select Print receipt.

**Expected:**
- browser print preview shows the actual receipt;
- preview is not blank;
- preview is an 80mm-wide page, not A4 or Letter and not the full POS screen;
- the printer itself must be set to an 80mm roll. The page does not grow with the receipt.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T62 — Reprint from Orders

**Do:** Open a completed order and reprint.

**Expected:**
- same stored receipt information is used;
- reprint does not create another sale;
- current catalog/settings changes do not rewrite the historic receipt.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T63 — Receipt name/SKU settings

Manager/Admin test only.

**Do:** In Management → Receipt settings, use a safe test location and adjust settings as authorized.

**Expected:**
- shortening changes future receipt display only;
- catalog product name stays unchanged;
- Show SKU affects receipt presentation;
- historic receipts remain unchanged.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# H. ORDERS

## T70 — Search Orders

**Do:** Search by order, receipt, customer, or transaction reference.

**Expected:**
- expected sale is found;
- displayed date/time is understandable.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T71 — Open order detail

**Expected:**
- customer, payment, total, items, and status are readable;
- Reprint and Return items appear when allowed;
- technical reference information is secondary/collapsible.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# I. RETURNS

## T80 — Normal return

**Do:**
1. start Return items from an eligible order;
2. select item/quantity;
3. enter reason;
4. select condition;
5. Review return;
6. Complete return.

**Expected:**
- summary matches what was selected;
- refund amount is understandable;
- completion status is clear.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T81 — Return condition options

**Expected available examples:**
- Resellable — unopened
- Resellable — opened
- Damaged
- Defective
- Quarantine
- Not physically returned

Record any missing/confusing options.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T82 — Return needs attention

**Do:** Use an existing safe requires-attention return if one is available.

**Expected:**
- the screen clearly separates what has already completed from what still needs review;
- if **Cash refund already completed** is shown, the cashier is clearly told not to refund the customer again;
- if **Order refund needs review** is shown, the cashier is clearly told not to create another order refund for the same return;
- if **Stock update is not settled yet** is shown, the cashier is clearly told not to adjust stock manually while the return is still being checked;
- the same existing return remains the thing to review instead of starting another one;
- raw internal IDs are not prominent;
- manager/support action is clearly separated from normal cashier action.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T83 — Manager return approval

Manager test only.

**Expected:**
- authorized manager can approve the existing return where required;
- cashier can continue the same return;
- approval does not itself create a second refund or stock change.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# J. ATTENTION / RECOVERY

## T90 — Attention list

**Expected:**
- outstanding work is understandable;
- operator sees a clear next action;
- already-completed effects are not repeated.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T91 — Payment recovery offline/presentation-only

**Expected:**
- recovery action is blocked when fresh server authority is unavailable;
- local diagnostic/presentation information may remain visible.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# K. OFFLINE TESTING

These are high-value tests. Follow the exact sequence.

## T100 — Online baseline

**Do:**
1. sign in online;
2. confirm correct register/shift;
3. add a safe product to cart;
4. note the exact build.

**Expected:** normal online operation.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T101 — Disconnect while POS is open

**Do:** Disconnect internet.

**Expected:**
- real POS remains visible;
- clear offline/unavailable message appears;
- cart remains;
- safe local product information remains available where cached.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T102 — Offline cold start

**Do:**
1. while still offline, completely close the installed PWA;
2. reopen it.

**Expected:**
- real POS shell opens, not a blank white page;
- valid last-verified cashier/register presentation remains visible while permitted;
- current cart remains;
- safe local products remain accessible.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T103 — Offline commercial actions blocked

While offline, attempt only the safe checks described in this workbook.

**Expected blocked until connection:**
- Pay / fresh authoritative price;
- Returns execution/resolve;
- Attention recovery;
- register-changing actions.

The POS must not pretend those actions succeeded.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T104 — Reconnect

**Do:** Restore internet.

**Expected:**
- authoritative session returns;
- cart is not lost;
- normal enabled actions return;
- no duplicate sale/cart is created.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# L. SAVED CART / LOCAL STATE

## T110 — One active working cart

**Do:** Start/complete multiple controlled sales and observe current cart state.

**Expected:**
- one current active working cart;
- completed/discarded carts are retired appropriately;
- System status does not treat every historical local draft as an active cart.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T111 — Reload with in-progress cart

**Do:** Add items but do not pay; reload/reopen the POS as described in this test.

**Expected:**
- safe draft/cart is preserved;
- no sale/payment is created by reload.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# M. SETTINGS / SYSTEM STATUS

## T120 — Settings

**Expected:**
- device/register/scanner/printer information is understandable;
- theme can be changed where enabled;
- System status is reachable;
- raw engineering diagnostics are not on the normal cashier screen.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T121 — Cashier System status

**Expected:**
- service availability uses plain language;
- staff can understand whether to retry/wait/contact manager;
- build/API/schema/provider internals are not primary cashier content.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# N. MANAGEMENT / ADMIN

Run only with authorized test accounts.

## T130 — Management visibility by role

Test Owner/Admin/Manager/Support/Cashier.

**Expected:**
- Cashier: no Management control plane.
- Manager: only permitted management scope/locations.
- Support: diagnostic/audit scope only.
- Owner/Admin: organization control sections as authorized.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T131 — Add staff: create account now

Owner/Admin test.

**Expected:**
- Name/Email validated;
- temporary password required;
- organization/location/register role can be set as allowed;
- access is not enabled if required setup fails;
- user must change temporary password at first sign-in.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T132 — Add staff: send invitation

**Expected:**
- invitation is sent/queued successfully when environment supports it;
- invited staff cannot operate POS until assignments/access are completed.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T133 — Disable POS access

**Expected:**
- disabled staff loses active POS sessions;
- cannot establish a new POS session;
- a new sign-in shows **Your POS access is disabled. Contact a manager.** and does not add a Reference line;
- audit/management record reflects the change.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T134 — Role hierarchy

**Expected:**
- Admin cannot reset/control an Owner in ways reserved for Owner;
- at least one active Owner remains;
- Manager cannot grant themselves organization control.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T135 — Manager register assignment

**Expected:**
- Manager may adjust register assignment only for staff already assigned to the manager's location;
- Manager cannot create a new location assignment or change the staff member's cashier/manager role unless explicitly authorized by the model.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T136 — Locations / registers / devices

Owner/Admin test.

**Expected:**
- add/update actions are scoped to organization;
- inactive location/register/device behavior is clear;
- a location without active POS device cannot open its register shift;
- register currency cannot be casually changed after creation.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T137 — Operational rules

**Expected:**
- rule scope (organization/location/register) is clear;
- configured shift-close/return-approval behavior matches the effective rule.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T138 — Shifts & cash management

**Expected:**
- X report is current/live;
- Z report is durable after close;
- cash correction reverses an existing entry rather than editing history;
- manager permissions are respected.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T139 — Management System status / Activity log

**Expected:**
- technical/support details are role-gated;
- activity log shows authorized management changes;
- cashier does not receive the same technical surface.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# O. RESPONSIVE / HARDWARE

## T140 — Desktop

Test selling, modal dialogs, Orders, Returns, Register, and Management where authorized.

**Expected:** no hidden/overlapping critical controls.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T141 — Tablet

**Expected:** touch controls are usable; important actions remain visible.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T142 — Phone

**Expected:** layout remains usable; navigation/actions do not require desktop width.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T143 — Scanner

**Expected:** normal keyboard-wedge scanning adds the correct product.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T144 — Printer

**Expected:** receipt appears in print preview as an 80mm-wide page, not A4 or Letter, and prints when the printer is set to an 80mm roll.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# P. END-OF-SHIFT

## T150 — Zero-variance close

Manager/authorized-role test.

**Do:** Count the exact physical staging drawer cash and close according to policy.

**Expected:**
- counted amount accepted;
- expected amount shown after count;
- variance GHS 0.00 when counts match;
- shift closes once;
- exactly one durable Z report exists.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

## T151 — Reopen/retry after close

**Expected:**
- refresh/retry does not create a second close or second Z report.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST  
**What actually happened:**  
**Anything confusing:**  
**Screenshot/photo:** embedded image or exact filename/path  
**Other notes:**  

---

# Q. FREE-FORM STAFF FEEDBACK

After structured testing, ask every tester:

1. What was confusing?
2. What took too many clicks?
3. What wording did you not understand?
4. What did you expect to happen that did not happen?
5. What happened that you did not expect?
6. Which part felt slow?
7. Did you ever feel unsure whether a sale/payment/refund had already happened?
8. Was anything technical shown that a normal cashier should not see?
9. Was anything important hidden from you?
10. Would you feel safe using this with a real customer? Why or why not?

Do not replace the structured tests with free-form feedback. Use both.
