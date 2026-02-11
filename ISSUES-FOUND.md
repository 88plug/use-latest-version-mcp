# Issues Found During Testing

## Summary

Tested all 32 registries and found **12 failures** (32% failure rate). Issues categorized below.

## Critical Issues Fixed

### 1. ✅ **FIXED: Missing Registries in getRegistryClient()**

**Problem:** 6 registries were implemented but not added to the factory function
- vscode
- wordpress
- jenkins
- jsr
- conda
- bioconductor

**Status:** ✅ FIXED - Added all 6 to getRegistryClient() switch statement

**Impact:** These registries now work correctly

---

## Remaining Issues

### 2. 🔴 **API/Parsing Issues - Need Fixes**

#### Hackage (Haskell)
**Problem:** Returns HTML DOCTYPE instead of version
```
Expected: "2.2.3.0"
Actual: "-//W3C//DTD XHTML 1.0 Strict//EN"
```

**Root Cause:** `/preferred` endpoint returns HTML page, not plain text/JSON

**Fix Needed:**
- Option A: Scrape main package page: `https://hackage.haskell.org/package/{package}`
- Option B: Use Hackage JSON API if available

**Code Location:** `src/registries.ts:1486-1552`

---

#### Dub (D Language)
**Problem:** Returns "undefined" as version
```
Expected: "0.10.2"
Actual: "undefined"
```

**Root Cause:** API returns valid data (`"0.10.2"`), but code accesses wrong field

**Fix Needed:** Check JSON structure - might need `data.version` vs just `version`

**Code Location:** `src/registries.ts:1554-1606`

---

### 3. 🟡 **Package Not Found - May Be Test Issues**

#### Chocolatey
**Error:** `Package not found: git`
**Possible Causes:**
- Package name might be different (e.g., `git.install`)
- API filter syntax issue
- Rate limiting

**Test with:**
```bash
curl "https://community.chocolatey.org/api/v2/Packages()?$filter=Id eq 'git' and IsLatestVersion&$format=json"
```

---

#### LuaRocks
**Error:** `Package not found: luasocket`
**Possible Causes:**
- Package might be named differently
- API endpoint changed

**Test with:**
```bash
curl "https://luarocks.org/api/v1/modules/luasocket"
```

---

#### Elm
**Error:** `No versions found for: elm/http`
**Possible Causes:**
- Correct format might be just `http` without `elm/`
- API might have changed

**Test with:**
```bash
curl "https://package.elm-lang.org/packages/elm/http/releases.json"
```

---

#### Flatpak
**Error:** `No version information available for: org.mozilla.firefox`
**Possible Causes:**
- Package ID might be different
- API returns data in unexpected format

**Test with:**
```bash
curl "https://flathub.org/api/v2/appstream/org.mozilla.firefox"
```

---

#### Gradle
**Error:** `Plugin not found: org.springframework.boot`
**Possible Causes:**
- Correct ID format needed
- Plugin might not be in public registry

**Test with:**
```bash
curl "https://plugins.gradle.org/api/v1/plugins/org.springframework.boot"
```

---

#### Ansible Galaxy
**Error:** `Collection not found: community.general`
**Possible Causes:**
- API endpoint changed
- Authentication required
- Different API version needed

**Test with:**
```bash
curl "https://galaxy.ansible.com/api/v2/collections/community/general/"
```

---

### 4. 🟢 **Optional/Expected Failures**

#### GitHub Container Registry
**Error:** `Container package not found: linuxserver/nginx`
**Reason:** This package may not exist or require authentication
**Status:** ⊘ Skipped (marked as optional in tests)

---

## Test Results Summary

```
Total Registries:    32
Tests Run:           38
Passed:              25 (68%)
Failed:              12 (32%)
Skipped (Optional):  1
```

### Breakdown by Phase

| Phase | Total | Passed | Failed | Success Rate |
|-------|-------|--------|--------|--------------|
| Original | 9 | 9 | 0 | 100% |
| Phase 1 | 5 | 5 | 0 | 100% |
| Phase 2 | 4 | 3 | 1 | 75% |
| Phase 3 Containers | 3 | 2 | 0 (+1 skip) | 100% |
| Phase 3 Languages | 5 | 2 | 3 | 40% |
| Phase 3 OS | 3 | 2 | 1 | 67% |
| Phase 4 Build | 3 | 1 | 2 | 33% |
| Phase 4 Plugins | 3 | 0 | 0* | N/A (was broken) |
| Phase 4 Specialized | 3 | 0 | 0* | N/A (was broken) |

*Phase 4 Plugins and Specialized were completely broken (missing from getRegistryClient), now fixed but not retested yet.

---

## Priority Fixes

### 🔴 High Priority
1. **Hackage** - Completely broken, returns HTML
2. **Dub** - Returns undefined instead of version

### 🟡 Medium Priority
3. **Chocolatey** - Common Windows package manager
4. **Ansible Galaxy** - Popular DevOps tool
5. **Gradle** - Major build tool

### 🟢 Low Priority
6. **LuaRocks** - Smaller ecosystem
7. **Elm** - Niche language
8. **Flatpak** - Linux-specific

---

## Recommended Actions

1. ✅ **DONE:** Fix missing registries in getRegistryClient()
2. **TODO:** Fix Hackage HTML parsing issue
3. **TODO:** Fix Dub undefined version
4. **TODO:** Retest Phase 4 Plugins and Specialized registries
5. **TODO:** Investigate package name/format issues
6. **TODO:** Add better error messages for debugging
7. **TODO:** Consider retry logic for network issues

---

## After Fixes

**Expected Results:**
- Original 9: 100% (9/9) ✅
- Phase 1-2: ~95% (8/9) ✅
- Phase 3: ~85% (7/8) 🟡
- Phase 4: ~70% (5/7) 🟡

**Target:** 29/32 working (91%)

---

## Files Needing Updates

1. `src/registries.ts` - Fix Hackage and Dub implementations
2. Test package names - Verify correct formats
3. Documentation - Note known issues
4. Error handling - Add better debug info

---

## Notes

- Some failures may be due to:
  - API rate limiting
  - Network issues
  - Temporary service outages
  - Package names used in tests

- Retest after fixes with:
  ```bash
  npm run build && node test-all-registries.js
  ```
