# 🔍 Wake Word Debugging Guide

## What Was Fixed

### Issue 1: Gemini Hallucinating Commands ✅
**Problem:** When you said nothing or unclear audio, Gemini invented transcripts like "buy milk and eggs" or "play lofi music"

**Fix:** Added explicit anti-hallucination instructions:
- Gemini must return `[SILENCE]`, `[UNCLEAR]`, or `[INAUDIBLE]` for empty audio
- Mobile app now detects these markers and resets cleanly
- No more fake commands being processed

### Issue 2: No Visual Feedback ✅
**Problem:** You couldn't tell when the app heard "Hey Night"

**Fix:** Added clear UI changes:
- Status changes to "🎤 SAY YOUR COMMAND NOW" when wake word detected
- Transcript shows "👂 I'm listening - speak your command..."
- Console logs show exactly when state transitions happen

### Issue 3: Delayed Response ✅
**Problem:** Recording for 4.5 seconds felt slow

**Fix:** Reduced to 3 seconds for faster response

---

## How to Test & Debug

### Step 1: Restart Everything
```bash
# Backend
cd backend
git pull
source .venv/bin/activate
uvicorn app.main:app --reload

# Mobile (in new terminal)
cd mobile
git pull
npm start
```

### Step 2: Watch the Console Logs

When the app starts, you should see:
```
🟢 STATE 1: Passive wake-word listening active
📡 Native speech unavailable, using Vosk backend for wake-word
```

### Step 3: Test Wake Word Detection

**Say "Hey Night" or "Night" clearly**

**Expected Console Logs:**
```
📡 Sending to local Vosk wake-word endpoint (no Gemini API)
✅✅✅ WAKE WORD DETECTED! Transcript: night
🚀 Transitioning to State 2 (Command Collection)
🎤 STATE 2: Wake word detected! Entering command collection mode
🔴 Recording started - speak your command now!
```

**Expected UI Changes:**
- Status bar: "🎤 SAY YOUR COMMAND NOW" (red dot)
- Transcript: "👂 I'm listening - speak your command..."
- Mic button: Turns RED

### Step 4: Give a Command

**Say something like "What's the weather?"**

**Expected Console Logs:**
```
⏱️ Recording time expired, processing command...
✅ Sending audio to Gemini API...
🚀 GEMINI API CALL: Uploading recording_xxx.m4a to /api/v1/process-audio
✅ GEMINI API RESPONSE: 200 (1234ms)
```

**Expected Result:**
- Transcript shows what you said
- Night gives a response

### Step 5: Test Silence Detection

**Say "Hey Night" then stay completely silent**

**Expected Console Logs:**
```
✅✅✅ WAKE WORD DETECTED!
🔴 Recording started - speak your command now!
⏱️ Recording time expired, processing command...
🚀 GEMINI API CALL: Uploading...
🔇 No clear speech detected, resetting...
```

**Expected UI:**
- Shows "I didn't catch that. Try again?"
- Resets back to listening for "Night"

---

## Troubleshooting

### Problem: Wake word NEVER triggers

**Check:**
1. Is the backend running? Open http://localhost:8000 in browser
2. Is Vosk endpoint working? Try: `curl http://localhost:8000/health`
3. Look for console errors in State 1 loop
4. Check microphone permissions in iOS Settings

**Debug:**
- Console should show `📡 Sending to local Vosk wake-word endpoint` every 3-4 seconds
- If you see `❌` marks, the endpoint is failing

### Problem: Wake word triggers but slowly (10+ seconds delay)

**Possible causes:**
1. Network latency to backend
2. Backend Vosk model loading slowly
3. Audio recording buffer filling up

**Check:**
```javascript
// Look for this in console:
"📡 Sending to local Vosk wake-word endpoint (no Gemini API)"
"✅✅✅ WAKE WORD DETECTED!"
```

If there's a big time gap between these, the backend is slow.

### Problem: Still getting hallucinated commands

**Check backend logs for:**
```python
print(f"🎤 AUDIO INTENT CLASSIFICATION: {len(audio_bytes)} bytes")
```

If audio is very small (<5KB), it's probably silence being sent.

**Solution:** Increase the silence threshold in VoiceScreen.jsx:
```javascript
if (!fileInfo.exists || fileInfo.size < 5000) {  // Changed from 1500
```

### Problem: Commands are being cut off

**If you need more than 3 seconds:**
```javascript
// In VoiceScreen.jsx, line ~349
}, 5000);  // Change from 3000 to 5000
```

### Problem: Too sensitive - triggers on background noise

**Backend Vosk detection is too aggressive:**
```python
# In backend/app/main.py, line ~128
wake_word_detected = any(kw in cleaned_text for kw in ["night", "knight", "nite"])
```

Make it more strict:
```python
# Require exact word match
wake_word_detected = cleaned_text in ["night", "knight", "nite", "hey night", "ok night"]
```

---

## Expected Behavior Summary

### ✅ Good Flow:
1. App starts → State 1 (green dot, "Listening for 'Night'")
2. Say "Night" → Detects within 1-3 seconds
3. UI changes immediately (red dot, "Say your command")
4. "Yes?" plays from speaker
5. 3 seconds to speak your command
6. Processing (yellow dot)
7. Response delivered
8. Returns to State 1

### ❌ Bad Signs:
- No console logs appearing at all
- Logs show errors or exceptions
- Wake word detected but UI doesn't change
- Commands being processed when you said nothing
- Long delays (10+ seconds) between state transitions

---

## Advanced: Native iOS Speech Recognition

If you want **instant** wake-word detection (no 3-4 second delay), you need to compile a native build:

```bash
cd mobile
npx expo prebuild
npx expo run:ios
```

This enables Apple's on-device Siri engine for 0-latency wake-word detection.

**Trade-offs:**
- ✅ Instant detection (100-200ms)
- ✅ No network calls
- ✅ More reliable
- ❌ Requires native build (can't use Expo Go)
- ❌ Takes ~10 minutes to compile

---

## Performance Metrics

### Good Performance:
- Wake word detection: 1-3 seconds
- State 1 → State 2 transition: Instant (< 100ms)
- Command recording: 3 seconds
- Gemini API response: 1-2 seconds
- **Total: "Hey Night" → Response = 5-8 seconds**

### If Slower:
- Check network latency: `ping your-backend-url`
- Check Gemini API response times in console logs
- Verify backend isn't overloaded

---

## Quick Reference: Console Log Legend

- 🟢 = State 1 (Passive listening)
- 🎤 = State 2 (Recording command)
- 📡 = Local Vosk call (free)
- 🚀 = Gemini API call (uses quota)
- ✅ = Success
- ❌ = Failure/Skip
- ⚠️ = Warning/Rate limit
- 🔇 = Silence detected
- ⏱️ = Timing info
