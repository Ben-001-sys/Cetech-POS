# Staff sign-in support references

One sign-in attempt has one correlation id. That same id is the browser password-grant failure reference, the BFF session request id, the diagnostic report, the structured server log, and the Reference line a cashier can read. Management System Health shows that reference with the time the server recorded it.

The in-memory recent list on System Health is the current server process only. It is not durable and it is not shared across instances. Do not treat a Vercel instance's recent list as the system of record.

The canonical cross-instance lookup is the structured log event `staff_sign_in_diagnostic`, keyed by `correlationId`. Search logs for that id. The log does not contain the email, password, bearer token, access token, service-role key, or invitation token.

Wrong-password and disabled-access failures are not support records. They keep the ordinary cashier sign-in wording and do not add a support reference.
