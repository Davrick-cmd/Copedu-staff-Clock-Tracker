# LDAP/AD configuration from the working app (Clock In and Out)

Use this to match the other app’s LDAP/AD setup. **Actual values** (URL, bind account, search base) come from **your .env or environment** where this app runs; the code only reads them. Fill in the “Your value” row from your working server’s config.

---

## 1. LDAP / AD configuration

| Item | Where it comes from in the working app | Your value (from your .env / server) |
|------|----------------------------------------|--------------------------------------|
| **LDAP URL** | Env: `LDAP_URL` or `LDAP_URI`. Example: `ldap://10.10.10.250:389` or `ldaps://dc.copeduplc.rw:636` | ............................ |
| **Service account (bind)** | Env: `LDAP_BIND_DN`. Can be: **Full DN** (e.g. `CN=iisuser,OU=Service,DC=copeduplc,DC=rw`), or **UPN** (e.g. `iisuser@copeduplc.rw`). The code uses this **as-is** for binding (ldap3 `Connection(user=bind_dn, password=...)`). So you can use Full DN or UPN; **DOMAIN\iisuser** is not used in this app (Windows might accept it; ldap3 typically expects DN or UPN). | ............................ |
| **Service account password** | Env: `LDAP_BIND_PASSWORD` | ............................ |
| **Search base** | Env: `LDAP_SEARCH_BASE`. Examples: `DC=copeduplc,DC=rw` or `OU=Users,DC=copeduplc,DC=rw`. Search is **SUBTREE** under this base. If the base is an OU, the code also tries the **domain root** (e.g. `DC=copeduplc,DC=rw`) automatically. | ............................ |
| **NetBIOS domain name** | **Not configured** in the app. The app uses **sAMAccountName** (short name) and **UPN** (user@copeduplc.rw). Domain from config is `LDAP_EMAIL_DOMAIN` (e.g. `copeduplc.rw`). NetBIOS (e.g. `COPEDUPLC`) is typically your AD’s short domain name; you can get it from AD or from how users log in as `DOMAIN\user`. | e.g. COPEDUPLC |

**Optional (have defaults):**

| Item | Default in code | Env override |
|------|------------------|--------------|
| LDAP enabled | true if URL + bind DN + password + search base are all set | `LDAP_ENABLED=1` or `true` or `yes` |
| Username attribute (for search) | `sAMAccountName` | `LDAP_USERNAME_ATTRIBUTE` |
| Display name attribute | `displayName` | `LDAP_NAME_ATTRIBUTE` |
| Email attribute | `mail` | `LDAP_EMAIL_ATTRIBUTE` |
| Default email domain (if mail empty) | `copeduplc.rw` | `LDAP_EMAIL_DOMAIN` |

---

## 2. How login works (bind / search)

**Answer: A — Service account + search + user bind.**

1. **Bind** with the **service account** (`LDAP_BIND_DN` + `LDAP_BIND_PASSWORD`).
2. **Search** for the user with filter `(sAMAccountName=<username>)` under the search base (SUBTREE). The `<username>` is normalized (see below).
3. If **exactly one** entry is found, take its **DN** (`entry_dn`).
4. **Unbind** the service account, then **bind again** with **user’s DN + password** (the password the user typed). If this bind succeeds, the password is correct.
5. Unbind and return success.

So: **we do not** only validate the user’s password with a single bind as the user. We **always** use a service account to find the user’s DN, then verify the password by a second bind as that user.

Code reference: `_ldap_authenticate()` in `backend/main.py` (lines 71–126).

---

## 3. Username format at login

**What the user can type in the “Username” or “Email” field:**

| Format | Accepted? | How it’s used |
|--------|-----------|--------------|
| **Plain username (sAMAccountName)** | Yes | e.g. `dmuganga` → search with `(sAMAccountName=dmuganga)`. |
| **UPN (user@domain)** | Yes | e.g. `dmuganga@copeduplc.rw` → we take the part **before** `@` → `dmuganga` → same search as above. |
| **DOMAIN\username** | Not normalized | The code does **not** strip `DOMAIN\`. So we’d search `(sAMAccountName=DOMAIN\dmuganga)`, which usually **does not** match (sAMAccountName is typically just `dmuganga`). So in practice the working app accepts **username** and **user@domain**, not `DOMAIN\user`. |

Normalization (backend): `_normalize_ad_username(identifier)` — if `@` is present, use the part before `@`; otherwise use the string as-is. So:

- **Accept:** `dmuganga` or `dmuganga@copeduplc.rw` (and we use `dmuganga` for AD search).

---

## 4. Attribute names (when we search AD)

- **Attribute used to find the user (filter):**  
  `sAMAccountName` (configurable via `LDAP_USERNAME_ATTRIBUTE`).  
  Filter: `(sAMAccountName=<normalized_username>)`.

- **Attributes we read from the user entry (for “Fetch from AD” / display):**
  - **Display name:** `displayName` (`LDAP_NAME_ATTRIBUTE`)
  - **Email:** `mail` (`LDAP_EMAIL_ATTRIBUTE`)

We do **not** use `cn` for the login search; we only use it implicitly if it’s part of the DN. So the other app should use **sAMAccountName** to find the user and can use **displayName** and **mail** the same way to avoid “user not found” or wrong name/email.

---

## 5. Port and TLS

- **Port:** Not hardcoded. It comes from **LDAP URL**:
  - `ldap://host:389` → port 389 (LDAP).
  - `ldaps://host:636` → port 636 (LDAPS).
- **TLS:** The app uses **ldap3** with the URL as given. So:
  - **ldap://** → no TLS (plain LDAP).
  - **ldaps://** → LDAPS (TLS).
  - **StartTLS** is **not** used in this code. If the other app needs StartTLS, they’d have to enable it in their client (e.g. ldap3 `Connection(..., auto_bind=True)` and then StartTLS if required).

So: **port and TLS are whatever you put in LDAP_URL** (e.g. `ldap://...:389` or `ldaps://...:636`).

---

## 6. Copy‑paste template (fill and send back)

Fill in the “Your value” parts from your **working** environment (.env or server config), then you can paste this to the other team.

```
WORKING APP LDAP CONFIG (Clock In and Out):

- LDAP URL: ...................................... (e.g. ldap://10.10.10.250:389 or ldaps://dc.copeduplc.rw:636)
- Bind/service account: .......................... (exact string: Full DN or UPN, e.g. CN=svc,OU=Service,DC=copeduplc,DC=rw or svc@copeduplc.rw)
- Search base: ................................... (e.g. DC=copeduplc,DC=rw or OU=Users,DC=copeduplc,DC=rw)
- NetBIOS domain: ............................... (e.g. COPEDUPLC – not in app config; from AD / DOMAIN\user)
- Login flow: A – service account bind → search for user by sAMAccountName → bind with user DN + password to verify.
- Username format at login: plain username (dmuganga) OR user@domain (dmuganga@copeduplc.rw). NOT DOMAIN\user.
- User search attribute: sAMAccountName (configurable via LDAP_USERNAME_ATTRIBUTE).
- Attributes read from user: displayName, mail (configurable via LDAP_NAME_ATTRIBUTE, LDAP_EMAIL_ATTRIBUTE).
- Port / TLS: from URL – 389 + ldap:// or 636 + ldaps://. No StartTLS in this app.
```

---

## 7. Errors from the working system (for reference)

These are the kinds of messages the app returns (so the other app can match behavior if needed):

- **"LDAP not configured (LDAP_URL, LDAP_BIND_DN, LDAP_BIND_PASSWORD, LDAP_SEARCH_BASE required)"** — one of the four is missing.
- **"LDAP is not enabled"** — LDAP not enabled or config incomplete.
- **"Connection to AD timed out. Check that the AD server is reachable from this machine."** — network/timeout.
- **"User not found in Active Directory"** — lookup (e.g. Fetch from AD) found no entry for that sAMAccountName.
- **"No account linked to this username. Ask an admin to add you."** — LDAP auth succeeded but no user in app DB with that `ad_username`.
- **"Invalid username or password"** — wrong password or user not found in AD.

---

## 8. Where to get your actual values

- On the **machine where the working app runs**, check:
  - **.env** in the backend folder (or the environment variables used by the process).
- Look for: `LDAP_URL` or `LDAP_URI`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_SEARCH_BASE`. Optionally `LDAP_EMAIL_DOMAIN`, `LDAP_USERNAME_ATTRIBUTE`, `LDAP_NAME_ATTRIBUTE`, `LDAP_EMAIL_ATTRIBUTE`.
- If the app also has an **admin UI** for settings, LDAP might be stored in the DB and shown there (this app can read from both env and DB settings).

Once you have those, fill the “Your value” column and the template in section 6 and share that with the other app team.
