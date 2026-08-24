"""Quick test to verify the brain.py fix works"""
import asyncio
from app.core.brain import ControllerBrain

async def test_audio_intent():
    brain = ControllerBrain()

    # Create fake audio bytes (empty for now)
    fake_audio = b"fake audio data"

    # This should NOT crash with "NameError: name 'prompt' is not defined"
    try:
        result = await brain.classify_audio_intent(fake_audio, mime_type="audio/m4a")
        print("✅ classify_audio_intent executed without NameError!")
        print(f"   Result: {result}")
    except NameError as e:
        if "prompt" in str(e):
            print(f"❌ FAILED: {e}")
            return False
    except Exception as e:
        # Other errors are OK for this test (e.g., API key issues, invalid audio)
        print(f"⚠️ Got expected error (not NameError): {type(e).__name__}")
        return True

    return True

if __name__ == "__main__":
    success = asyncio.run(test_audio_intent())
    print("\n" + "="*50)
    if success:
        print("✅ FIX VERIFIED: No NameError for undefined 'prompt'")
    else:
        print("❌ FIX FAILED: Still getting NameError")
    print("="*50)
