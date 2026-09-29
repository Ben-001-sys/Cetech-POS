import { describe, expect, test } from "vitest";
import { customerReceiptPlaceLabel, isInternalReceiptReference } from "./customer-presentation";

describe("customer receipt place labels", () => {
  test("keeps a human location or register name", () => {
    expect(customerReceiptPlaceLabel("Accra Main Store", "Store")).toBe("Accra Main Store");
    expect(customerReceiptPlaceLabel("Front Counter", "Register")).toBe("Front Counter");
  });

  test("does not present an internal location id or uuid as the customer label", () => {
    expect(isInternalReceiptReference("loc_a1")).toBe(true);
    expect(customerReceiptPlaceLabel("loc_a1", "Store")).toBe("Store");
    expect(customerReceiptPlaceLabel("reg_a1", "Register")).toBe("Register");
    expect(customerReceiptPlaceLabel("11111111-1111-4111-8111-111111111111", "Store")).toBe("Store");
    expect(customerReceiptPlaceLabel("  ", "Store")).toBe("Store");
  });
});
