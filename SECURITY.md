# Security & Operations

This bot stores tenant secrets (Telegram bot tokens, Paystack keys, Omada /
MikroTik credentials) **encrypted at rest** with AES-256-GCM. The encryption
key lives only in the environment as `ENCRYPTION_KEY`. Protecting and rotating
that key — and keeping it out of git — is the single most important operational
task here.

---

## 1. First-time setup

1. Copy the template and fill it in:
   ```bash
   cp .env.example .env
   ```
2. Generate an encryption key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Put the result in `ENCRYPTION_KEY`. In production the app **refuses to
   start** without it.
3. On the host (Render → Environment), set the same variables. `.env` is only
   for local dev and is git-ignored.

---

## 2. If a secret leaked (e.g. `.env` was committed)

Assume **everything** in that file is compromised. Rotate, in order:

1. **`ENCRYPTION_KEY`** — see §3. This protects all tenant secrets, so it goes
   first.
2. **Each tenant's provider secrets** — regenerate at the source and re-enter
   them via the admin commands:
   - Telegram bot token → BotFather `/revoke` then `/token`.
   - Paystack secret/public keys → Paystack dashboard → Settings → API Keys →
     roll.
   - Omada client id/secret and admin password → Omada controller.
   - MikroTik credentials → the router.
3. **Purge the secret from git history** — see §4. Rotation alone is not enough;
   the old values stay in every clone and on GitHub until history is rewritten.

---

## 3. Rotating `ENCRYPTION_KEY` without bricking tenants

Every tenant secret is encrypted with the current key. If you just swap the key,
none of them can be decrypted and every bot dies. Use the re-encryption script,
which decrypts with the old key and re-encrypts with the new one inside a single
transaction (rolls back on any failure):

```bash
# 1. Generate the NEW key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Run rotation with the CURRENT key as OLD and the new one as ENCRYPTION_KEY
OLD_ENCRYPTION_KEY=<current key> ENCRYPTION_KEY=<new key> npm run rotate

# 3. On success, set ENCRYPTION_KEY=<new key> in the host env,
#    REMOVE OLD_ENCRYPTION_KEY, and redeploy.
```

Notes:
- `decrypt()` tries the current key first, then `OLD_ENCRYPTION_KEY`, and
  **throws** if both fail — a wrong key is loud, never a silent auth failure.
- The script (`src/services/rotateKey.js`) is idempotent per-run and
  transactional: if any secret fails to decrypt, nothing is written.

Add a `rotate` script to `package.json` if it isn't there yet:
```json
"rotate": "node src/services/rotateKey.js"
```

---

## 4. Purging a secret from git history

Rotating replaces the live secret; it does **not** remove the old value from
past commits. Rewrite history with `git filter-repo` (preferred) or the BFG.

**git filter-repo:**
```bash
pip install git-filter-repo
# Remove the file from all of history
git filter-repo --path .env --invert-paths
# Re-add the remote (filter-repo drops it) and force-push
git remote add origin <url>
git push origin --force --all
git push origin --force --tags
```

**BFG alternative:**
```bash
bfg --delete-files .env
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push origin --force --all
```

After rewriting:
- Every collaborator must re-clone (old clones still contain the secret).
- Consider the secret permanently burned regardless — treat §2 rotation as
  mandatory, not optional.
- `.env` is now in `.gitignore`, so it won't be re-added by accident.

---

## 5. Tests

Pure security/payment logic is covered by `node:test`:
```bash
npm test
```
Covers encryption round-trip, wrong-key-throws, key rotation via
`OLD_ENCRYPTION_KEY`, and the payment guards (amount verification, plan
gb/validity, metadata parsing).
