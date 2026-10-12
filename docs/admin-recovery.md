# Lost administrator passkey recovery

This is a database-operator procedure, not self-service recovery. Ordinary password reset never removes passkeys. Prefer an enrolled backup passkey when available. No HTTP endpoint can reset administrator MFA.

## Before any real recovery

1. Open a restricted incident case. Independently verify the account owner's identity using established organizational contacts, not only the requesting email, password, support message or current browser session. Record evidence in the restricted case, never in CLI arguments or public support replies.
2. Obtain a separate authorized reviewer approval. The command records operator and case identifiers but does **not** authenticate the named operator or technically enforce two-person approval. Use individually attributable, access-controlled database credentials and retain provider access logs. These operational controls must be established before launch.
3. Notify the owner through an established independent channel before/after the change; investigate unexpected recovery requests. Automatic recovery notification delivery is not implemented by this command. Record notification evidence in the case.
4. Confirm the intended database and UUID. Reset can remove the last administrator. Keep a tested operator recovery path; never enable a public bypass to solve a lockout.

## Preview and apply

Use secured `MONGODB_URI` and `MONGODB_DATABASE` environment values. Never include database secrets as command arguments.

```text
npm run admin:recover -- --user USER_UUID --operator OPERATOR_ID --case CASE_REFERENCE --reason "Verified lost-key recovery decision"
```

Review the database, account, key count and last-admin warning. Add `--apply --confirm USER_UUID` only after completing verification and approval. Exact confirmation guards against accidents; possession of authorized database access is the actual authority.

The single majority-acknowledged user update clears all passkeys, changes role to player, increments authorization version and appends a recovery audit event. It compares the previously read role, authorization version and entire credential list; concurrent credential changes cause a conflict rather than deletion of an unseen key. Suspension and email verification are not changed. All old sessions, step-up proofs and account-version-bound grants stop authorizing access. Old session documents may remain until normal expiry, but are invalid. Repeating recovery on a player with no keys is a no-op.

## Restore only after verification

If compromise is suspected, complete account/password and email security remediation first. A separate `admin:grant` decision is required to restore privilege, subject to verified/adult/unsuspended eligibility. Regrant revokes prior player sessions. The administrator signs in again, enrolls a new passkey, then verifies it before moderation works. Add and test a backup key from an already verified session.

Do not restore a database backup containing old authorization state without an explicit session/key revocation plan. Command output is not proof of owner identity, notification delivery or an operationally rehearsed recovery.

## Evidence

Disposable database tests cover preview/confirmation, old-session and MFA rejection, role/key/audit atomicity under write failure, concurrent reset, suspension preservation and the actual CLI. A real cryptographic verifier test covers recovery → denial of old session and player enrollment → separate regrant → replacement enrollment → required assertion. Real-device and production operator rehearsals remain outstanding.

Reference reviewed October 12, 2026: [OWASP Multifactor Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html). Recovery is a high-risk authentication path; the operator procedure must not be treated as ordinary password support.
