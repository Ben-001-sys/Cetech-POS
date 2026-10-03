# CETECH POS — Staff Testing & Acceptance Workbook

**Updated for this testing round:** 3 October 2026 — management candidate checks added.

**UI refinement candidate — 3 October 2026:** Additional guidance marked **Candidate UI** describes `ws1/ui-refinement-2026-10-03`. Use it only when the coordinator confirms that candidate in the Test Brief. This note does not mean the existing POS link has been updated.

**Management remediation candidate — 3 October 2026:** Guidance marked **Candidate Management** describes the current management correction candidate. Use it only after the coordinator confirms its exact build in the Test Brief. Source changes and these instructions do not establish that the shared POS link has changed or that a reported live problem is resolved.

**Read and understand the [current Test Brief](TEST-BRIEF-2026-10-02.md) first.**

**[Open the POS for this round](https://cetech-pos-staging-git-integration-9578df-wbdevworlds-projects.vercel.app)**

Use this same address when opening or installing the POS. If your installed POS already uses it and works, keep using it and preserve your saved work.

**Purpose:** Help staff test the POS systematically, not randomly.\
**Audience:** Cashiers, managers, owners/admins, and authorized support testers.\
**Rule:** Test the exact build recorded in the Test Brief. Do not mix results from different builds.

---

## Choose your testing modules

Use the current dated [Test Brief](TEST-BRIEF-2026-10-02.md) for the POS link and this round's rules.

One designated **Admin** sets up staff, registers, and devices in **M00**. Once your own setup works, choose any module whose starting needs are met. You do not have to complete the whole workbook from top to bottom. Two people can choose the same module using their own registers and test records.

Each tester needs a separate register for an independent shift. Separate accounts on the same register do not provide separate shifts. Each register's location also needs an active POS device. The Admin can test selling too, with a Cashier or Manager location role and their own assigned register.

Follow dependent steps inside a module in order. Record tests you cannot run as **COULD NOT TEST**, with the reason. Leave unattempted tests unmarked and list them in your handoff. A PASS needs the stated result, not just a screen opening.

| Choose | Module | Tests | Who / what you need before starting |
| --- | --- | --- | --- |
| [ ] | [M00 Team setup and Management](#m00--team-setup-and-management) | T130–T139 | Designated Admin; other role accounts only for the specific permission checks |
| [ ] | [M01 Sign-in and access](#m01--sign-in-and-access) | T01–T05 | Your account; T03 needs a new account; T05 needs a developer's controlled setup |
| [ ] | [M02 Register and shift](#m02--register-and-shift) | T10–T14 | Your assigned register and an active device; T11/T12/T14 need separate agreed setups |
| [ ] | [M03 Products and cart](#m03--products-and-cart) | T20–T25 | Saved/available products; T22 needs a scanner; T24 needs your completed sale; T25 needs a genuine out-of-date product list |
| [ ] | [M04 Customers and prices](#m04--customers-and-prices) | T30–T33 | Agreed test customers/products; your own shift for sale steps |
| [ ] | [M05 Cash sale](#m05--cash-sale) | T40–T42 | Your open shift, agreed test product, test cash; T42 needs controlled uncertainty |
| [ ] | [M06 Receipts and printing](#m06--receipts-and-printing) | T60–T63 | Your completed sale for T62; a fresh uninterrupted sale for T60/T61; Admin for T63 changes |
| [ ] | [M07 Orders](#m07--orders) | T70–T71 | Your completed order or an agreed view-only test order |
| [ ] | [M08 Returns](#m08--returns) | T80–T83 | Your fresh eligible test order; agreed safe case for T82; location Manager for T83 |
| [ ] | [M09 Attention and saved work](#m09--attention-and-saved-work) | T90–T92 | Safe existing unfinished test work; T92 needs two testers sharing one agreed browser |
| [ ] | [M10 Offline and reconnect](#m10--offline-and-reconnect) | T100–T104 | POS installed from the round's link; online sign-in and a saved cart first; run in order |
| [ ] | [M11 Saved cart](#m11--saved-cart) | T110–T111 | Your own safe unfinished cart and browser profile |
| [ ] | [M12 Settings and status](#m12--settings-and-status) | T120–T121 | Your Cashier account |
| [ ] | [M13 Screens and equipment](#m13--screens-and-equipment) | T140–T144 | Available computer/tablet/phone/scanner/printer; record missing equipment |
| [ ] | [M14 Shift close](#m14--shift-close) | T150–T151 | Your open shift, recorded test cash, and permission to close it or an agreed Manager helper |
| [ ] | [M15 Electronic payments](#m15--electronic-payments) | T50–T51 | Separate owner permission for that method and test; otherwise COULD NOT TEST |

At the end, complete [staff feedback](#staff-feedback) and submit your results plus every referenced image.

### Keep each person's work separate

- Use your own account, register, browser profile, cart, and test orders for ordinary testing.
- Do not close another person's shift or return their order.
- Do not change someone's access, register assignment, or shared settings while they are testing. Permission-change tests need an agreed helper and a separate test account.
- Admin does not automatically mean Manager. Return approvals and shift actions still need the right location role and permission.
- Shared-browser testing is the deliberate exception in T92. Preserve unfinished work and follow that test's instructions.
- Cash is the ordinary payment for this round. Appearance of another method is not permission to use it.
- Never use the protected historical refund case under issue #102 as a normal return test.
- If a sale, payment, refund, or stock result is uncertain, stop repeating that action and document it. Do not clear saved POS/browser data.

---

## 1. How to record every test

Make your own copy of this workbook and write your results in it.

For every test you perform, add this result block underneath that test:

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

At the top of your completed workbook, also record:

- Tester name:
- Date/time:
- Device:
- Browser / installed PWA:
- Test role:
- Test version/build shown in the Test Brief:
- Exact POS link used:
- Your location / register / selected POS device:
- Modules chosen:
- Tests not attempted or not finished, and why:

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

`POS-Test-Results-YourName-YYYY-MM-DD.md`

Save screenshots in a folder such as:

`POS-Test-Screenshots-YourName-YYYY-MM-DD/`

Then submit:

1. the completed Testing Workbook; and
2. the entire screenshot/photo folder containing every file referenced in the workbook.

Example:

- Workbook: `POS-Test-Results-Ama-YYYY-MM-DD.md`
- Screenshot: `POS-Test-Screenshots-Ama-YYYY-MM-DD/T61-blank-print-preview-01.png`

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

# M00 — Team setup and Management

**Before you start:** The designated Admin starts here. Use T136 to set up registers/devices before T131/T132 assigns new staff to them. Record the actual setup in your copy of the current Test Brief. Use spare agreed accounts for T133/T134/T135. Do not disable the working testers or change their assignments mid-test. T137 and T63 change settings others may share, so agree on the affected test location/register and record the previous settings. Restore the previous settings afterward only when no tester is still using the test change. Admin needs a separate Cashier/Manager location role for cashier/manager actions. T138 uses your own test shift or an agreed view-only shift.



## T130 — Management visibility by role

Test Owner/Admin/Manager/Support/Cashier.

**Candidate Management check:** Open Staff & access, Locations, Registers, Devices, Returns & approvals and Receipt settings where your role permits. If loading lasts long enough to see, compare the grey placeholders with the page's real cards, work items or receipt editor/preview afterward. Confirm placeholders disappear into actual results, an honest empty state or an error. Record loading too quick to observe as such; a screenshot of placeholders alone is not proof of readiness. Requests must finish or show a bounded error/timeout and release their busy controls.

**Expected:**
- Cashier: no Management control plane.
- Manager: only permitted management scope/locations.
- Support: diagnostic/audit scope only.
- Owner/Admin: organization control sections as authorized.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T131 — Add staff: create account now

Owner/Admin test.

**Do:** In Management → Staff & access, select Create account now. Enter the agreed Name and Email, create/generate a temporary password, choose Cashier at the test location, assign that person's own active register, and enable POS access after setup succeeds. Give the temporary password privately. Have the new staff member complete T03 and check Register under T13.

**Expected:**
- Name/Email validated;
- temporary password required;
- organization/location/register role can be set as allowed;
- access is not enabled if required setup fails;
- user must change temporary password at first sign-in.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T132 — Add staff: send invitation

**Do:** As Owner/Admin, use Send invitation for a separate agreed test account. The recipient checks the email, opens its setup link, completes account setup, and signs in through the current Test Brief link. Confirm their location/register assignments and enabled POS access before they try Register. Record delivery and account setup separately. Do not put the invitation link in screenshots or the workbook.

**Expected:**
- invitation is sent/queued successfully when environment supports it;
- invited staff cannot operate POS until assignments/access are completed.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T133 — Disable POS access

**Candidate Management check:** Use a separate agreed test account, never the active testers or your own account. Compare its sign-in email, login-account state and POS-access state. Use **Show staff** to check Active staff, Inactive staff and Unlinked references. Do not invent an unlinked reference or alter an identity merely to obtain one; record unavailable cases as COULD NOT TEST.

Select **Deactivate staff**, then **Keep active**, and confirm nothing changed. Repeat and choose **Confirm deactivation**. Verify the person is signed out and cannot establish a new POS session; inspect their retained record under **Inactive staff**. With authorization, **Reactivate staff** and verify normal sign-in again. A disabled/unlinked login cannot be reactivated through POS access alone. If a save fails, its card and permitted controls must remain visible alongside the error.

**Expected:**
- disabled staff loses active POS sessions;
- cannot establish a new POS session;
- a new sign-in shows **Your POS access is disabled. Contact a manager.** and does not add a Reference line;
- audit/management record reflects the change;
- deactivation retains sales, shifts, assignments and activity history rather than deleting the account;
- a linked card shows the actual sign-in email; an unlinked reference is explicitly identified and has no password reset, role grant or new-assignment controls;
- login-account availability and POS-access state are not combined into a misleading single status.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T134 — Role hierarchy

**Expected:**
- Admin cannot reset/control an Owner in ways reserved for Owner;
- at least one active Owner remains;
- Manager cannot grant themselves organization control;
- ordinary staff deactivation cannot target yourself or an Owner;
- an Admin cannot reactivate an Owner;
- disabled or unlinked login accounts do not receive a POS-reactivation control.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T135 — Manager register assignment

**Expected:**
- Manager may adjust register assignment only for staff already assigned to the manager's location;
- Manager cannot create a new location assignment or change the staff member's cashier/manager role unless explicitly authorized by the model.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T136 — Locations / registers / devices

Owner/Admin test.

**Do:** Use Management → Locations, Registers, and Devices to set up separate test registers as directed. Check the agreed location and GHS before creating each register. Ensure its location has an active POS device. Record each tester's assignment in the Test Brief's working copy. Have each person verify Register with their own account. Use a spare test setup for inactive/no-device checks. Do not deactivate a location or device others are using.

**Expected:**
- add/update actions are scoped to organization;
- inactive location/register/device behavior is clear;
- a location without active POS device cannot open its register shift;
- register currency cannot be casually changed after creation.

**Candidate Management check:** On a spare agreed setup, use **Deactivate location**, **Disable register** and **Deactivate device**. Cancel first, then confirm the permitted change; inspect the retained entry and use its **Reactivate** action. No history or assignments should disappear. After deactivation, rename/save the retained entry and verify that it does not silently become active again.

With the coordinator's controlled open shift, attempt the affected lifecycle change or device relocation. It must be blocked with an instruction to close or resolve that shift; the existing entry and retry controls remain visible. Check Closing and Needs attention cases only when safely supplied by the coordinator; do not manufacture them by interrupting sales. Closed-only history may remain while an unused setup is deactivated.

An inactive location must reject a new shift even when its register/device is active. A newly active register/device cannot be created or reactivated under an inactive parent location. Owner/Admin performs changes; Manager remains read-only.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T137 — Operational rules

**Expected:**
- rule scope (organization/location/register) is clear;
- configured shift-close/return-approval behavior matches the effective rule.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T138 — Shifts & cash management

**Expected:**
- X report is current/live;
- Z report is durable after close;
- cash correction reverses an existing entry rather than editing history;
- manager permissions are respected.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T139 — Management System status / Activity log

**Expected:**
- technical/support details are role-gated;
- activity log shows authorized management changes;
- cashier does not receive the same technical surface.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M01 — Sign-in and access

**Before you start:** Use your own account. T03 pairs with the Admin's T131 or T132 setup. T04 needs a Cashier-only account. T05 is a separate specialist check and does not hold up ordinary testing.


## T01 — Normal staff sign-in

**Do:** Sign in with an authorized cashier account.

**Candidate UI check:** Before signing in, switch **Show** then **Hide** and confirm that the password is retained. Do not capture the revealed password in a screenshot.

**Expected:**
- sign-in succeeds;
- normal POS appears;
- correct staff identity is shown;
- only authorized work areas are available.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T03 — Temporary password change

**Do:** Use a test account that must change its temporary password.

**Expected:**
- normal POS remains closed until password is changed;
- the user can set and confirm a new password;
- after success, normal authorized POS access becomes available.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T04 — Cashier cannot enter Management

**Do:** Use a cashier-only account and try the normal UI/direct Management route if your test setup allows it.

**Expected:**
- Management controls are not shown to the cashier;
- direct unauthorized access fails closed.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T05 — Sign-in when a service is unavailable

**Developer-assisted test only.** Do not stop services, change connections, or alter accounts yourself. If the controlled setup is unavailable, record COULD NOT TEST.

**Do:**
1. Use an agreed test account while the developer creates a controlled service failure.
2. Attempt sign-in once. Record the time, the message, and any Reference shown.
3. Give the developer the Reference through the private test report. The developer checks that it identifies the matching failure in the service records.
4. After service is restored, try normal sign-in. Check a wrong password separately under T02.

**Expected:**
- a service problem is described as sign-in being unavailable, rather than an incorrect password or missing assignment;
- the Reference helps the developer find the same problem without exposing private information;
- normal sign-in works after restoration;
- a wrong password still has the ordinary wrong-password message, without a Reference.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M02 — Register and shift

**Before you start:** Use your own assigned register at a location with an active device. One register supports one open/closing shift at a time. For T10, do not take over an existing shift. T11/T12 need spare test setups. T14 needs an agreed helper and must not change another active tester's assignment.


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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T11 — No active device

**Do:** Use a test register/location with no active device, only if that test setup is available.

**Expected:**
- shift cannot open;
- message clearly explains that an active POS device is required.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T12 — Register outside staff assignment

**Do:** Attempt an out-of-scope register only if a safe out-of-scope test account/setup is available.

**Expected:**
- access is refused;
- staff is not locked out of their valid register;
- valid register remains selectable.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M03 — Products and cart

**Before you start:** Use agreed training products. Record how quickly saved products appear after sign-in and whether the POS stays usable while products refresh. T24 uses your own completed sale from M05. T25 verifies the out-of-date → refresh → ready sequence; a fresh list alone does not prove it.


## T20 — Search product by name

**Do:** Search for a known staging product.

**Candidate UI check:** Switch **Grid**, **List**, and **Compact**. Check that products/prices and the current cart stay the same, and that your chosen view remains after a normal refresh. These are browser/device preferences.

**Expected:**
- correct product appears quickly;
- name/price presentation is readable.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T21 — Long product name

**Do:** Find a product with a very long name.

**Expected:**
- compact screen layout remains usable;
- name is visually limited where appropriate;
- full product identity is not changed in the data/search behavior.

**Candidate UI check:** **List** wraps the full product name; keyboard focus expands a name in **Grid**. The cart also wraps full names. Verify these without changing or shortening the product data.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T22 — Barcode scan

**Do:** Scan a known test barcode.

**Expected:**
- correct product/variation is found;
- scan does not add the wrong product.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T23 — Quantity change

**Do:** Add an item, increase/decrease quantity, then remove it. Time each price check from the click until the total appears. Record the seconds or minutes for adding the item and changing its quantity.

**Expected:**
- quantity changes correctly;
- totals respond appropriately;
- the price check finishes without waiting several minutes; record the actual time, even if it eventually succeeds;
- removing the line removes it from the working cart.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T25 — Refresh an out-of-date product list

**Starting need:** The POS already shows that saved products may be out of date. Do not change product data or delete saved products to force this condition. If it is unavailable, record COULD NOT TEST.

**Do:**
1. Capture the out-of-date product message and the product status in Settings → System status.
2. With internet restored, use the available Refresh products or Try again action for that warning. If that action is restricted to Management, work with the Admin and record which role used it.
3. Record the message during the refresh and afterward, including how long it took.
4. Check the warning and product status again. Search for a known saved product.

**Expected:**
- saved products remain usable for safe browsing while refresh runs;
- a successful refresh changes the product status to ready and clears the out-of-date warning;
- a failed refresh keeps an honest warning and does not claim the products are up to date;
- the cart and unfinished work remain saved;
- refreshing products does not bypass the fresh price check before payment.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M04 — Customers and prices

**Before you start:** Use agreed training customers and products. A price shown on a saved product is not the final payment price. Complete sale steps only with your own open shift and cash testing permission.


## T30 — Walk-in sale

**Do:** Prepare a normal walk-in sale. Record how long the price takes to appear. If a price check fails and **Check price again** appears, select it once and record the result. Do not deliberately break a service to force this condition.

**Expected:**
- Walk-in works without selecting a customer account;
- the price appears promptly; record the actual wait;
- after a failed check, retry keeps the same products and quantities and does not create a payment or sale;
- Pay stays unavailable until a valid price is ready.

Record the retry part as **COULD NOT TEST** if no failed check or retry button is available. A several-minute wait is a failure to report, even if the price eventually appears.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T31 — Retail customer

**Do:** Search and select a known retail test customer.

**Expected:**
- correct customer is selected;
- the selection carries to the sale.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T32 — Wholesale customer

**Do:** Select an approved B2B/wholesale test customer.

**Expected:**
- Wholesale is shown;
- authoritative price is returned;
- cashier is not asked to manually calculate wholesale pricing.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T33 — Customer search unavailable

**Do:** Only if an unavailable-customer-search test condition is available.

**Expected:**
- message is understandable;
- Walk-in remains available where safe;
- no fake customer data appears.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M05 — Cash sale

**Before you start:** Open your own shift first. Use an agreed small training sale and test cash. T41 is the deliberate double-confirmation check and must not create a second transaction. T42 needs a safe controlled case; do not repeatedly interrupt ordinary sales to force it. For the first-receipt check, use a separate normal T40 sale and go straight to T60/T61 without reloading, signing out, or going offline.


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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T41 — Double-click / repeated cash confirmation

**Do:** Only in the test environment. Attempt the same confirmation twice or repeat after a slow response.

**Expected:**
- no duplicate order;
- no duplicate cash payment;
- existing transaction is reused/resolved.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M06 — Receipts and printing

**Before you start:** For T60/T61, complete a fresh T40 cash sale and inspect/print its first receipt immediately. Do not reload, sign out, go offline, or use recovery first. Record the human location/register name, date/time, items and total. If interrupted, record that separately and do not count it as uninterrupted first-receipt proof. T62 then reprints the same stored receipt from Orders. An older receipt proves reprint only. A print-preview screenshot and a physical printer result are separate evidence. T63 changes need Owner/Admin; a Manager can check the permitted view.


## T60 — Completed-sale receipt

**Do:** Complete a staging sale and view the receipt.

**Expected:**
- receipt has understandable date/time;
- product/variation text is readable;
- totals are correct;
- no prominent raw technical/debug block appears on the customer receipt.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T61 — Print receipt

**Do:** Select Print receipt.

**Expected:**
- browser print preview shows the actual receipt;
- preview is not blank;
- preview keeps the printer's selected paper size and shows only the receipt;
- for thermal printing, match the printer's paper width to the 80 mm or 58 mm device choice;
- the receipt starts near the top with a small margin and keeps its text size; blank space on a longer sheet is below the receipt, not above and below it;
- longer receipts continue onto later pages without a blank first page or clipped rows.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T62 — Reprint from Orders

**Do:** Open a completed order and reprint.

**Expected:**
- same stored receipt information is used;
- reprint does not create another sale;
- current catalog/settings changes do not rewrite the historic receipt.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T63 — Receipt presentation, preview and printer settings

Owner/Admin changes; Manager view-only.

**Do:** In Management → Receipt settings, use a safe test location and adjust settings as authorized.

Preview a business name/address/footer change before saving. Upload a small valid PNG/JPEG logo if available. Try the customer/cashier display choices. Use **Test print (sample)**, then match **Printer paper width on this device** to the physical printer. After saving, use a separately agreed new sale to check the actual receipt. Change a presentation setting and reprint that completed receipt to check preservation. Restore shared settings after coordinated testing.

**Candidate Management check:** Agree on the affected locations first; applying shared layout changes future receipts across the organization. Record the shared defaults and each test location's local address/contact/tax fields before starting.

1. Choose **Shared defaults — all locations**, change the shared business name/logo/footer/display choices, preview, then **Save shared defaults**. Existing location rows must remain unchanged until explicit adoption.
2. Open **Apply shared layout to all locations**, review the warning, then **Cancel**. Confirm no location changed.
3. Repeat and choose **Confirm: apply shared layout**. Verify future receipt layout follows the saved common settings while each location's explicit address, phone, tax number and actual location name remain correct. The action must be disabled while shared changes are unsaved.
4. Under **Location overrides**, customize one field only and **Save location overrides**. Verify unchecked fields inherit the shared values. Check a deliberate local false, blank or removed-logo choice where permitted; it must not be replaced by the shared value.
5. On a spare agreed location only, inspect **Use shared settings for this location**. Its confirmation explains that all local receipt overrides, including address/contact/tax details, will be cleared. Cancel unless that complete reset is authorized.
6. Reprint a receipt completed before these changes. Its stored layout and presentation must remain unchanged. Confirm the printer's device paper width also stayed unchanged.

Managers must receive a scoped read-only location view, without shared-save, bulk-apply or local-save actions.

**Expected:**
- shortening changes future receipt display only;
- catalog product name stays unchanged;
- Show SKU affects receipt presentation;
- historic receipts remain unchanged.
- unsaved branding changes appear in the preview; sample printing is clearly marked and creates no sale/payment/stock effect;
- Owner/Admin can save; Manager can inspect but cannot change the location configuration;
- new receipts show numbered items, quantity, separate unit price, line totals and correct payment details;
- blank optional fields are omitted; customer phone is shown only when available and enabled;
- reprints preserve the completed receipt's logo, header, footer and customer presentation after later settings changes;
- 80 mm/58 mm paper preference persists on this device and does not change other devices;
- a physical print has readable text, aligned amounts and no clipped rows. Record physical hardware evidence separately from browser preview.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M07 — Orders

**Before you start:** Use your own completed order, or an agreed view-only order. Record its displayed order number and test time so the result can be matched later. Do not return or change another tester's order.


## T70 — Search Orders

**Do:** Search by order, receipt, customer, or transaction reference.

**Expected:**
- expected sale is found;
- displayed date/time is understandable.

**Candidate UI check:** If loading is visible, placeholder rows give way to actual results or an honest empty/error message. Search/status controls remain reachable, and the page does not need sideways scrolling on a phone. Record when loading was too quick to observe.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T71 — Open order detail

**Expected:**
- customer, payment, total, items, and status are readable;
- Reprint and Return items appear when allowed;
- technical reference information is secondary/collapsible.

**Candidate UI check:** Full item names wrap. In a long order, scroll the details while permitted actions remain visible at the bottom. With a keyboard, check Tab/Shift+Tab stays in the dialog, Escape closes it, and focus returns to the order button. Opening/closing the dialog must not start a return or print a receipt.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M08 — Returns

**Before you start:** Use your own fresh eligible test order for return execution. Once a return starts, keep that same return until its result is clear. T82 needs an agreed safe case and is view-only unless a separate action is explicitly authorized. The old issue #102 refund case is excluded. T83 needs an operational Manager at the location; organization Admin alone is insufficient.


## T80 — Normal return

**Candidate UI check:** You may find the same eligible sale in Returns by entering an order/customer/receipt and choosing **Search sales** (or pressing Enter). Full item names should wrap. An unresolved return must still hide/lock other sales; continue that return instead of starting a new one.

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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T83 — Manager return approval

Manager test only.

**Candidate Management check:** In Management → Returns & approvals, use **Review existing return** on an agreed saved return. Verify original items, reasons, allocated amounts and separate refund/stock states. Opening or refreshing the details must not approve, refund or change stock.

Check a current approval-required return at your managed location. **Approve return** records approval for that same return; the cashier then continues it. An Owner/Admin without an operational Manager assignment must not get approval or refund-check authority from the organization role alone. A Manager outside the return location must not receive those actions.

An expired preview belongs under **History**, shows **Return preview expired**, and cannot be approved/completed. A preview with unconfirmed validity explains that it needs review. A valid Pending preview must explain that it is not a pending approval. Counts are work items; separate refund/stock entries must not be mistaken for additional approval requests. Record missing safe examples as COULD NOT TEST.

**Expected:**
- authorized manager can approve the existing return where required;
- cashier can continue the same return;
- approval does not itself create a second refund or stock change.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M09 — Attention and saved work

**Before you start:** Use agreed safe unfinished work. Viewing a notice is different from retrying a financial action. T91 checks that offline recovery is blocked. T92 is the deliberate shared-browser exception and needs two testers plus a safe unknown-result case.


## T90 — Attention list

**Original-sale recovery candidate — 3 October 2026:** After the coordinator confirms this build, use an agreed unfinished test sale from your own sign-in/device/register. As a cashier or an assigned manager:

1. Select **Check / Recover** and capture its visible result. The control must become usable again when checking finishes or times out.
2. If offered, select **Repair this sale** once. Confirm the POS resumes the same original order and total on Sell; repair must not take payment or create a second order.
3. Stop at payment choice for this check. Record whether the same saved sale resumed. Do not confirm cash or start an electronic payment for this recovery-only test.
4. In a separately agreed expired-session case, confirm recovery opens sign-in and keeps the cart and unfinished work. Signing in must not automatically resend the operation.
5. The original-device recovery must block a missing/mismatched saved attempt, another person's attempt, existing payment, or unproven order/reservation with a clear result. Manager access must not bypass those local checks. If a recovered reservation expires before payment, confirm no new payment starts; status checks for already-recorded payment must remain available.

**Candidate Management check:** For a separately agreed server-recorded unfinished sale, use **Manager sale recovery → Check original sale** as an operational Manager at that sale's location. Checking reads the same original sale and causes no repair or payment. **Repair this sale** is offered only after original request/order/reservation/register/device/shift evidence is proved. If offered, select it once, record the result and stop before any payment.

Success directs you to the original register to check and continue the same sale, and explicitly states that no payment was taken. This must not create a new order, collect payment or replace the manager's current cart. Missing original evidence, unsafe order/reservation state, wrong location role or Owner/Admin-only membership must stay blocked with an explanation. An unavailable or timed-out check must release its busy control; inspect this same existing sale before retrying. Do not use real unknown payment outcomes to manufacture this test. Record cases not safely supplied by the coordinator as COULD NOT TEST.

**Expected:**
- outstanding work is understandable;
- operator sees a clear next action;
- already-completed effects are not repeated.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T91 — Payment recovery offline/presentation-only

**Expected:**
- recovery action is blocked when fresh server authority is unavailable;
- local diagnostic/presentation information may remain visible.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T92 — Another person signs into the same browser

**Two-person, controlled test only.** Use the same browser profile and exact POS link for A and B. A developer must provide or help create a safe case where A's sale result is genuinely unknown. An ordinary saved cart is not enough. Do not deliberately interrupt a real payment or use the protected case under issue #102. If a safe case is unavailable, record COULD NOT TEST.

**Do:**
1. A signs in and uses A's assigned register. Capture the agreed unfinished sale and the message saying its result is not known.
2. A signs out normally without clearing browser data or saved POS work.
3. B signs into that same browser profile using B's own account. Capture any unfinished-work notice before taking another action.
4. B checks their own assigned register. Do not pay or refund A's sale, or start a replacement sale for it.
5. An authorized Manager/support helper checks whether A's unresolved work makes the shared register/device unsafe. Record the allowed next step. Do not assume B must always be allowed to sell.

**Expected:**
- A's unfinished work is preserved;
- B is not told that B created A's sale;
- B does not gain access to resolve A's work merely by signing in;
- B's selling is blocked if the unresolved work makes the shared register/device unsafe, with an understandable explanation;
- unrelated safe work is not blocked solely because a different person left work in that browser;
- authorized review of the existing work remains possible, without another sale/payment/refund or clearing browser data.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M10 — Offline and reconnect

**Before you start:** Run T100 → T101 → T102 → T103 → T104 in that order on the POS installed from the current brief's exact link. Record device, browser/PWA, times, and the saved cart before disconnecting. Before T100, install and open it online so the app and safe local products are saved. Do not clear data. Reconnecting must check current permission again. An ordinary browser-tab test does not prove installed-PWA cold start. The developer should help arrange an additional pass across online-session expiry while still inside the permitted offline period. Record that boundary condition separately; a quick offline reopen does not close that part of #114.


These are high-value tests. Follow the exact sequence.

## T100 — Online baseline

**Do:**
1. sign in online;
2. confirm correct register/shift;
3. add a safe product to cart;
4. note the exact build.

**Expected:** normal online operation.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M11 — Saved cart

**Before you start:** Use your own browser profile and unfinished test cart. Reloading must preserve that work. Do not clear browser data as part of this module.


## T110 — One active working cart

**Do:** Start/complete multiple controlled sales and observe current cart state.

**Expected:**
- one current active working cart;
- completed/discarded carts are retired appropriately;
- System status does not treat every historical local draft as an active cart.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T111 — Reload with in-progress cart

**Do:** Add items but do not pay; reload/reopen the POS as described in this test.

**Expected:**
- safe draft/cart is preserved;
- no sale/payment is created by reload.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M12 — Settings and status

**Before you start:** Use Cashier-only access to check what ordinary staff see. Technical Management screens are checked separately under M00.


## T120 — Settings

**Expected:**
- device/register/scanner/printer information is understandable;
- theme can be changed where enabled;
- System status is reachable;
- raw engineering diagnostics are not on the normal cashier screen.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T121 — Cashier System status

**Expected:**
- service availability uses plain language;
- staff can understand whether to retry/wait/contact manager;
- build/API/schema/provider internals are not primary cashier content.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M13 — Screens and equipment

**Before you start:** Choose the equipment you actually have. For computer/tablet/phone, check both cashier screens and, with the authorized account, Management. Record unavailable equipment as COULD NOT TEST. Changing device does not let you open a second independent shift on the same register.


## T140 — Desktop

Test selling, modal dialogs, Orders, Returns, Register, and Management where authorized.

**Candidate UI check:** Confirm the compact navigation, clear loading placeholders, and routine messages leave search/cart/payment controls usable. Check long customer and item names without changing the stored data. Record the selected Grid/List/Compact view.

**Expected:** no hidden/overlapping critical controls.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T141 — Tablet

**Expected:** touch controls are usable; important actions remain visible.

**Candidate UI check:** Try both product views and density choices. Check order-detail actions remain reachable while details scroll, and search/filter/form controls do not overlap or force the whole page sideways.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T142 — Phone

**Expected:** layout remains usable; navigation/actions do not require desktop width.

**Candidate UI check:** Reach each labelled work area in the bottom navigation (swipe the navigation when needed). Confirm the working register is readable, cart/Pay controls remain reachable, and Orders/Customers/Returns/Register do not force the whole page sideways. Also check with the on-screen keyboard open. If safe existing work needs review, confirm the **Needs attention** shortcut and count remain visible without scrolling the navigation; do not create uncertain work just to force this condition.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T143 — Scanner

**Expected:** normal keyboard-wedge scanning adds the correct product.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T144 — Printer

**Expected:** print preview keeps the selected printer paper size, with the receipt near the top and the same text size. For thermal printing, match the printer's 80 mm or 58 mm paper width to this device's setting. Check the physical print separately.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M14 — Shift close

**Before you start:** You can choose this module as soon as your own test shift is ready to close; you need not wait for everybody else. Count the recorded test cash. If policy requires a Manager, use an agreed helper with that location role rather than granting Admin to the Cashier. Never close another tester's shift. Finish any uncertain work on your own shift through the safe review path before closing.


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

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T151 — Reopen/retry after close

**Expected:**
- refresh/retry does not create a second close or second Z report.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# M15 — Electronic payments

**Before you start:** This module is not enabled for ordinary testing in this round. Record T50/T51 as COULD NOT TEST unless the owner separately authorizes the specific method and test. Seeing a payment option does not give permission to use it.


Only run these tests when the owner has authorized that payment method and the specific test.

## T50 — Method availability

**Expected:**
- only configured methods are shown as available;
- Mobile Money and Card are independently enabled;
- a provider credential alone does not make a method appear usable.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

## T51 — Pending electronic payment

**Expected:**
- POS clearly says payment is still being checked;
- **Do not charge again** is visible;
- starting a duplicate payment is prevented.

### Your result

**Result:** PASS / FAIL / PARTLY WORKED / COULD NOT TEST\
**What actually happened:**\
**Anything confusing:**\
**Screenshot/photo:** embedded image or exact filename/path\
**Other notes:**

---

# Staff feedback


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
