# 🔧 NightAI Quota Exhaustion Fix - Summary

## Date: 2026-08-23

## 🚨 Critical Issues Found & Fixed

### **Issue #1: UNDEFINED PROMPT VARIABLE (HIGHEST PRIORITY)**
**File:** `backend/app/core/brain.py:204`  
**Severity:** 🔴 CRITICAL - Causes 2x API usage on EVERY command

#### Problem:
```python
response = await model.generate_content_async([audio_part, prompt])
# ERROR: 'prompt' was never defined!
```

This caused **100% of audio commands to crash** and trigger the fallback pipeline, which makes:
1. ❌ 1st Gemini call for STT transcription
2. ❌ 2nd Gemini call for intent routing

**Result:** Every command used **2x your Gemini quota** instead of 1x.

#### Fix Applied:
```python
# Added the missing prompt definition
prompt = (
    "Listen to this audio recording. "
    "Transcribe the exact spoken words into the 'transcript' field. "
    "Then analyze the user's intent and provide the structured routing decision as specified in the system instructions."
)
```

**Impact:** Reduces Gemini API usage by **50%** immediately.

---

### **Issue #2: NO API CALL SAFEGUARDS (HIGH PRIORITY)**
**File:** `mobile/src/screens/VoiceScreen.jsx`  
**Severity:** 🟠 HIGH - Could cause API spam

#### Problem:
- No guard against concurrent API calls
- No rate limiting between requests
- State transitions could trigger duplicate uploads
- Speech callbacks could fire multiple times

#### Fixes Applied:

1. **Added concurrent call prevention:**
```javascript
const isProcessingApiCallRef = useRef(false); // Prevent overlapping calls
```

2. **Added rate limiting (minimum 2 seconds between API calls):**
```javascript
const lastApiCallTimeRef = useRef(0);
const timeSinceLastCall = now - lastApiCallTimeRef.current;
if (timeSinceLastCall < 2000) {
  console.log(`⚠️ Rate limit: Only ${timeSinceLastCall}ms since last call, skipping`);
  return;
}
```

3. **Added comprehensive logging:**
```javascript
console.log("🚀 GEMINI API CALL: Uploading...");
console.log("✅ GEMINI API RESPONSE: 200 (1243ms)");
console.log("📡 Sending to local Vosk wake-word endpoint (no Gemini API)");
```

**Impact:** Prevents accidental API spam from race conditions or rapid state changes.

---

### **Issue #3: STATE 1 CONTINUOUS LOOP**
**File:** `mobile/src/screens/VoiceScreen.jsx:221-263`  
**Severity:** 🟡 MEDIUM - Monitored with logging

#### What's Happening:
State 1 (PASSIVE wake-word listening) runs a continuous loop:
- Records 3.5 seconds → Processes → Restarts (400ms delay)
- This is **CORRECT** behavior for always-on listening
- However, it calls the **LOCAL Vosk endpoint**, NOT Gemini (0 API cost)

#### Verification Added:
```javascript
console.log("📡 Sending to local Vosk wake-word endpoint (no Gemini API)");
```

**Status:** ✅ Working as designed - No Gemini API calls in State 1.

---

## 📊 Expected Results After Fixes

### Before:
- ❌ Every command used **2x Gemini API quota** (STT + routing)
- ❌ No protection against concurrent calls
- ❌ No visibility into when API calls were happening

### After:
- ✅ Every command uses **1x Gemini API quota** (single-pass audio)
- ✅ Minimum 2-second cooldown between API calls
- ✅ Duplicate call prevention
- ✅ Full logging of all API activity

**Estimated Quota Savings: ~50% reduction**

---

## 🧪 Testing Checklist

1. **Verify single-pass audio works:**
   - Say "Hey Night"
   - Give a command
   - Check logs show only ONE `🚀 GEMINI API CALL` per command
   - Check backend shows no fallback messages

2. **Verify rate limiting works:**
   - Try triggering commands rapidly
   - Should see `⚠️ Rate limit` warnings
   - Commands should be skipped if <2 seconds apart

3. **Verify wake-word detection uses Vosk:**
   - Check logs show `📡 Sending to local Vosk wake-word endpoint`
   - Confirm NO Gemini API calls during passive listening

4. **Monitor Gemini quota usage:**
   - Check https://aistudio.google.com/app/apikey
   - Verify requests match expected 1 per command

---

## 🔍 Additional Monitoring

Add these to your backend logs to track usage:

```python
# In brain.py, at the start of classify_audio_intent:
print(f"🎤 AUDIO INTENT CLASSIFICATION: {len(audio_bytes)} bytes")

# After successful response:
print(f"✅ Single-pass audio succeeded with {model_name}")
```

---

## 📝 Files Modified

1. ✅ `backend/app/core/brain.py` - Added missing prompt definition
2. ✅ `mobile/src/screens/VoiceScreen.jsx` - Added API safeguards and logging

---

## 🚀 Next Steps

1. **Restart the backend server** to load the fixed code
2. **Rebuild the mobile app** to get the safeguards
3. **Test with logging** to verify single-pass audio works
4. **Monitor quota usage** for 24 hours to confirm 50% reduction

---

## ⚠️ Important Notes

- The **State 1 continuous loop is correct behavior** - it's listening for wake words using LOCAL Vosk
- Only **State 2 (command collection)** should hit the Gemini API
- Each command should make **exactly 1 Gemini API call**, not 2
- Rate limiting prevents accidental spam if something goes wrong

---

## 📞 If Issues Persist

If you still see excessive API usage after these fixes:

1. Check backend logs for "Falling back to 2-step" messages
2. Check mobile logs for duplicate "🚀 GEMINI API CALL" messages
3. Verify the State 1 loop is hitting `/detect-wake-word`, not `/process-audio`
4. Check for multiple app instances running simultaneously
