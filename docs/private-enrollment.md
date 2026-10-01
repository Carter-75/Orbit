# Private owner and tester enrollment

Keep `PUBLIC_LAUNCH=false`. In production, only a valid email-bound enrollment code can pass registration while that gate is closed. This is not public launch and does not enable payments, ads or administrator privileges. Development registration remains open for local testing.

## Operator steps

In the authorized operator environment with the intended database's `MONGODB_URI` and `MONGODB_DATABASE` already supplied securely:

```sh
npm run enrollment:invite -- --email owner@example.com
```

This previews without writing. Check the database and normalized recipient email, then explicitly issue:

```sh
npm run enrollment:invite -- --email owner@example.com --apply --confirm owner@example.com
```

The command prints a **secret code** once for private delivery to that recipient. Do not run it in CI/build logs, commit its output, include it in a URL, post it in chat, or record it in screenshots. The database stores only hashes, not the raw code or raw recipient email in the enrollment record. An email hash is still personal data, not anonymity. The issuance command does not send email or assert that a recipient received it.

The recipient opens Orbit, chooses Create an account, and enters the same email plus the code into Invitation code. Normal age/password rules apply. The new account is an unverified player; real email delivery and verification are still necessary. For the adult owner, continue with [administrator assignment](admin-provisioning.md) only after verification, then sign in again. Invited teen accounts remain players and cannot use that admin command.

Codes expire after 24 hours, are consumed once, and cannot be used with another email. Issuing a replacement invalidates the previous code for that email. TTL removes expired records asynchronously; authorization checks expiry synchronously and never depends on cleanup timing. Origin and credential attempt limits still apply. Nothing is exposed through a public invitation issuance/list endpoint or a special startup environment credential.

## Interrupted signup and recovery

The code is consumed after form validation/password hashing, just before account insertion. An insertion conflict or crash can burn a code without creating an account; this deliberately fails closed rather than replaying an uncertain operation. If signup fails, first attempt normal sign-in/password recovery and inspect whether the intended account exists. If it does not, issue a replacement and retry with an available username. The issuance command refuses an email already associated with an account. Do not manually mark emails verified or reuse consumed records.

This flow has local production-mode API evidence, not deployed browser/email evidence. Tests exercise real MongoDB and actual verification-link handling with a captured test mail sender. Separate browser tests check the masked/labeled form and clear-on-mode-switch behavior, not live delivery or HTTPS deployment. Production administrator MFA, operator audit attribution, provider connectivity and launch review remain outstanding. Database operators must be individually authorized; confirmation flags prevent mistakes, not unauthorized database access.
