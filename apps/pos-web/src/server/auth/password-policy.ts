const WEAK = /^(password|changeme|temporary|cetech|12345678)/i;

export function temporaryPasswordError(password: string): string | null {
  return passwordRuleError(password, "temporary password");
}

/** Password chosen by the invited person. Same strength rules, ordinary wording. */
export function chosenPasswordError(password: string): string | null {
  return passwordRuleError(password, "password");
}

function passwordRuleError(password: string, noun: "password" | "temporary password"): string | null {
  if (password.length < 12 || password.length > 128) {
    return `Use a ${noun} of at least 12 characters.`;
  }
  if (/\s/.test(password)) {
    return noun === "temporary password"
      ? "Temporary passwords cannot contain spaces."
      : "Passwords cannot contain spaces.";
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return noun === "temporary password"
      ? "Use upper-case, lower-case, and a number in the temporary password."
      : "Use upper-case, lower-case, and a number.";
  }
  if (WEAK.test(password)) {
    return noun === "temporary password"
      ? "Choose a stronger temporary password."
      : "Choose a stronger password.";
  }
  return null;
}

export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let body = "";
  for (const byte of bytes) {
    body += alphabet[byte % alphabet.length];
  }
  return `Aa7${body}`;
}
