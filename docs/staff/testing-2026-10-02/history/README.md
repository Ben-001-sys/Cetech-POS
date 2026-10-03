> **Historical record — 24 September 2026.** Do not use its old POS link for the current round. Read the [current brief](https://github.com/WB-DevWorld/cetech-pwa-pos/tree/ws3/management-remediation-2026-10-03/docs/staff/testing-2026-10-02/brief) first.

---

# CETECH POS — Staff Test

**Date:** 24 September 2026

## What we are doing

Today we are doing two things:

1. learning how to use the new CETECH POS; and
2. testing it properly before we depend on it for normal work.

You do **not** need to understand how the software was built. Use the POS as a normal staff member would and tell us whenever something is confusing, wrong, slow, missing, or unexpected.

---

## The POS to use today

> This is the **current POS test version** for 24 September 2026. Its source, automated checks, independent review, and exact Preview have passed. Some live return/refund/stock behavior in the training environment is still part of what this test session must help verify. Use only the version below for this test session.

**Open the POS here:** **https://cetech-pos-staging-euh0w6ano-wbdevworlds-projects.vercel.app**

**Version being tested:** **CETECH POS test build `d0480d33`**

Please use only the link above during this test session.

---

## Before you start

Read the [Staff Training & User Guide](https://github.com/WB-DevWorld/cetech-pwa-pos/tree/ws3/quote-latency-2026-10-02/docs/staff/testing-2026-10-02/training) first.

Use the [Staff Testing & Acceptance Workbook](https://github.com/WB-DevWorld/cetech-pwa-pos/tree/ws3/quote-latency-2026-10-02/docs/staff/testing-2026-10-02/workbook) while carrying out the tests.

---

## What we especially want you to test

Please pay close attention to:

- signing in;
- opening the correct register;
- scanning and searching for products;
- adding, removing, and changing quantities;
- selecting Walk-in, Retail, and Wholesale customers where appropriate;
- checking prices;
- completing a cash sale;
- other payment methods only when they are available in the test POS;
- viewing and printing receipts;
- finding previous Orders;
- Returns;
- messages saying something needs attention;
- whether a completed cart clears properly;
- going offline and coming back online;
- whether your cart survives a connection loss;
- Settings and System status;
- Manager/Admin screens if your test account is allowed to use them;
- adding/managing staff if you are testing as Owner/Admin;
- closing a shift only where your test account is allowed to do it;
- desktop, tablet, phone, scanner, and printer behavior where available.

---

## Very important rules

### If a payment looks stuck

Do **not** pay again.

Do not repeat the payment. Record what happened and take a screenshot if possible.

### If a return or refund says it needs attention

Do **not** create another return or refund for the same thing.

Record what happened and take a screenshot if possible.

### If printing fails

Do **not** repeat the sale.

The sale and the print job are different things.

### If the POS goes offline

Do not clear browser data, cookies, site data, or saved storage.

Continue the offline test exactly as instructed.

### If you think money, stock, or an order may have been affected incorrectly

Stop repeating that specific action. Record exactly what happened and capture a screenshot or photo if possible.

---

## What counts as a problem?

Please report anything that feels wrong, including:

- confusing wording;
- a button that does nothing;
- the wrong product or customer;
- wrong price or total;
- a screen that becomes blank;
- being unexpectedly signed out;
- a cart disappearing;
- a completed cart staying active;
- duplicate orders or payments;
- a blank receipt;
- dates/times that are difficult to understand;
- technical information appearing where normal staff should not see it;
- an Admin/Manager option that is missing;
- something you expected to work offline that does not;
- something that works but is unnecessarily difficult.

You do not need to know the technical cause.

---

## How to document a problem

Record the problem directly in your completed Testing Workbook.

For each problem, include:

**Test number:**  
**What you were trying to do:**  
**What you clicked/did:**  
**What you expected:**  
**What happened instead:**  
**Did it stop you from continuing?** Yes / No  
**Screenshot/photo:** embedded in the document **or** the exact screenshot filename/path

If a message appears on screen, include it in the screenshot where possible.

### Screenshots

You may either:

1. add the screenshot directly into your Markdown document; or
2. save the screenshot separately and write its filename/path in the document.

Example filename:

`T40-cash-sale-payment-problem-01.png`

Example folder/path:

`screenshots/T40-cash-sale-payment-problem-01.png`

If you embed the image in Markdown, use the normal Markdown image format and point it to the exact screenshot file you submit.

Do not rename or delete a screenshot after referencing it in the document.

---

## What you must submit

At the end of testing, submit:

1. your **completed Testing Workbook**; and
2. all screenshot/photo files referenced by that workbook.

Recommended names:

- Workbook: `POS-Test-Results-YourName-2026-09-24.md`
- Screenshot folder: `POS-Test-Screenshots-YourName-2026-09-24/`

Example:

- `POS-Test-Results-Ama-2026-09-24.md`
- `POS-Test-Screenshots-Ama-2026-09-24/T40-cash-sale-01.png`

If screenshots are stored inside a folder, submit the whole folder and keep the filenames/paths exactly as written in the workbook.

A problem without a screenshot can still be reported. Just describe clearly what happened.

---

## At the end, record

- What was easiest?
- What was most confusing?
- What felt too slow?
- What wording did you not understand?
- Was there anything you were afraid to click?
- Did you ever wonder whether a payment/refund had already happened?
- Was anything too technical for normal staff?
- What would you change before using this with real customers?

---

<details>
<summary><strong>Test session record — staff do not need this section</strong></summary>

This section is kept only so every result can be tied to the exact software version that was tested.

- Exact Git SHA/build: `d0480d331c037a62edffb8845adc67524d2cabb8`
- Source PR/candidate: PR #109 / #105 candidate at exact head `d0480d331c037a62edffb8845adc67524d2cabb8`
- Immutable Preview/test URL: `https://cetech-pos-staging-euh0w6ano-wbdevworlds-projects.vercel.app`
- Preview/workflow reference: **Exact SHA Preview** run #17, run id `35970288357` — **SUCCESS**; Vercel deployment `dpl_FFZKnbXiKNCzD7SrsQhJWw8mVQMx`
- Qualification evidence: PR CI #1378 / run `35938935088` — **SUCCESS**; push CI #1377 / run `35938929010` — **SUCCESS**; independent exact-head review — **APPROVED** by `Ben-001-sys`
- Supersedes the earlier morning freeze to `7292cf2844c5d6724a36f71f8ef2474cdc30e7bb`; no staff testing had started when this replacement was issued.
- Training bridge status: exact reviewed `d0480d33` bridge source is installed on `training.cetechbpa.com`; health/route registration and auth-closure checks passed.
- Training bridge package SHA-256: `970d7893504ffea816477f3c8778f623631f0d27cd9e8ce1aee6d11253135af2`.
- No Woo refund, stock change, database change, Supabase change, production action, or mutation of the existing ambiguous return was performed during bridge installation.
- Remaining environment acceptance: a **new safe authenticated staging sale/return** must verify the refund + stock path end to end. This is part of the controlled testing period and is not pre-marked PASS.
- Safety boundary: if any return/refund/stock result is uncertain, record it and do not repeat the financial or stock effect.
- Session start:

If the test version changes during the session, record the new version separately. Do not mix results from different versions.

</details>
