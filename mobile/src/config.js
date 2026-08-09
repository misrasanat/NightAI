// ==============================================================================
// NightAI Client Configuration
// ==============================================================================

// For iOS/Android Simulators: Use "http://localhost:8000"
// For Physical Devices (Expo Go on iPhone/Android): 
// Replace "localhost" with your computer's local Wi-Fi IP address (e.g., "http://192.168.1.15:8000")
// Make sure both your phone and PC are connected to the same Wi-Fi network.
export const BACKEND_URL = "https://nightai.onrender.com";
export const WS_BACKEND_URL = BACKEND_URL.replace(/^http/, "ws");
