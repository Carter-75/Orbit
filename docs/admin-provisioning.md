# Operator-controlled administrator access

`npm run admin:grant` grants moderation access to an **existing, verified, unsuspended adult account**. It is not an HTTP route, registration shortcut, email-verification bypass, or recurring startup job. It never creates an account or changes a password. Do not grant access to an ordinary creator just so they can publish: creators submit builds to a separately authorized moderator.

Run from the repository using Node 22 and installed dependencies, in an authorized operator environment with the correct `MONGODB_URI` and `MONGODB_DATABASE`. The URI belongs in a secret environment or ignored `.env`, not command arguments, source control, screenshots or chat. Protect host/provider access with MFA. Database write access is the authority to execute this command; the confirmation flag only protects against accidental target selection.

1. Obtain the intended user's exact UUID from their signed-in `/api/auth/me` response (`user.id`) or an authorized account lookup. Verify the account and target database with the owner.
2. Preview without mutations:
   ```sh
   npm run admin:grant -- --user USER_UUID --reason "Owner approved initial moderator"
   ```
3. Inspect the database name, UUID, username and role in the output. Apply only when correct:
   ```sh
   npm run admin:grant -- --user USER_UUID --reason "Owner approved initial moderator" --apply --confirm USER_UUID
   ```
4. Sign in again. Role change, authorization-version increment and audit event are one majority-acknowledged database update. Existing sessions, account links and game grants with the previous authorization version no longer authorize access. Physical session records need not be immediately deleted to revoke them.
5. Verify the moderation workspace with that account and verify an ordinary account still cannot use it. Review privileges periodically. The internal `privilegeHistory` records the action, time, reason and operator-command source; it does **not** identify the individual shell operator. Correlate with provider/operator access logs. Do not put secrets in the reason.

Concurrent requests cannot append duplicate grants. An already-admin result does not rotate sessions again. An account changed between reading and writing fails closed and needs a fresh inspection. If a network timeout makes the outcome uncertain, run the preview to inspect current state; do not assume a failed command means no database write happened.

## Removing administrator access

Use an authorized operator environment and preview the exact target:

```sh
npm run admin:revoke -- --user USER_UUID --reason "Moderator access ended after owner review"
```

After checking the database, username, UUID and target role, apply with `--apply --confirm USER_UUID`. The account becomes a player; it is not deleted, unsuspended or marked verified. The role change, authorization-version increment and `revoke_admin` history entry are atomic. Existing sessions lose access; even a subsequent valid player session cannot use admin endpoints. Repeating removal of an already-player account makes no further changes. Unlike granting privileges, removing them is permitted when the administrator is suspended or unverified.

This can remove the **last administrator**; the preview warns about that possibility rather than implying a race-prone administrator count is a safety guarantee. Keep a separately authorized operator recovery path and test it before production. For recovery, use the grant command on a verified, unsuspended adult account and sign in again. Do not temporarily add a public promotion endpoint. Removing the role is not password recovery or a complete incident response: investigate compromise, rotate affected provider credentials where appropriate, and review the retained audit trail. A network failure can leave the result uncertain; preview current state before retrying.

## Remaining release gates

Production has not been provisioned. Use [private enrollment](private-enrollment.md) to register the intended owner while `PUBLIC_LAUNCH=false`; **do not temporarily open public registration, seed a demo account, or manually mark email verified**. This command covers privilege assignment after legitimate registration/verification, not email-provider setup or deployed validation.

Administrator MFA, rehearsed operator recovery, access recertification, operator-identity attribution and production account verification remain launch work. The commands are not proof that production admin access is ready. They add no new environment settings to Render and are never run automatically on deployment.

Design references: [OWASP least-privilege authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [session changes after privilege elevation](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), and [MFA for privileged accounts](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).
