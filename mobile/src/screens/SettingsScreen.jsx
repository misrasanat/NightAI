import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Switch,
  Alert,
  Linking,
  AppState,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { BACKEND_URL } from "../config";

export default function SettingsScreen({ navigation }) {
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [isWakeWordActive, setIsWakeWordActive] = useState(true);
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);

  const fetchSettings = () => {
    fetch(`${BACKEND_URL}/api/v1/settings`)
      .then((res) => res.json())
      .then((data) => {
        if (data.user_name) setUserName(data.user_name);
        if (data.user_email) setUserEmail(data.user_email);
        if (data.wake_word_active) setIsWakeWordActive(data.wake_word_active === "true");
        if (data.spotify_connected) setIsSpotifyConnected(data.spotify_connected === "true");
        if (data.google_connected) setIsGoogleConnected(data.google_connected === "true");
      })
      .catch((err) => {
        console.log("Failed to load settings from database:", err);
      });
  };

  // Fetch settings from SQLite database on mount & app focus
  useEffect(() => {
    fetchSettings();

    // Re-fetch when returning to the app from Google OAuth browser
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        fetchSettings();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Save configurations back to the database
  const handleSave = () => {
    const payload = {
      user_name: userName,
      user_email: userEmail,
      wake_word_active: isWakeWordActive ? "true" : "false",
      spotify_connected: isSpotifyConnected ? "true" : "false",
      google_connected: isGoogleConnected ? "true" : "false",
    };

    fetch(`${BACKEND_URL}/api/v1/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          Alert.alert("Success", "Settings saved successfully.");
        } else {
          Alert.alert("Error", "Could not save settings.");
        }
      })
      .catch((err) => {
        Alert.alert("Network Error", "Could not connect to the backend server.");
        console.log(err);
      });
  };

  // Google OAuth Connection Trigger
  const handleGoogleConnect = () => {
    if (isGoogleConnected) {
      // Disconnect
      fetch(`${BACKEND_URL}/api/v1/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ google_connected: false }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setIsGoogleConnected(false);
            Alert.alert("Disconnected", "Your Google accounts have been unlinked.");
          }
        })
        .catch((err) => {
          Alert.alert("Error", "Could not connect to backend to disconnect Google.");
          console.log(err);
        });
    } else {
      // Connect
      Linking.openURL(`${BACKEND_URL}/api/v1/auth/google`).catch((err) => {
        Alert.alert("Error", "Failed to open web browser. Make sure backend and Google client credentials are set up.");
        console.log("Failed to open OAuth URL:", err);
      });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>USER PROFILE</Text>
          
          <View style={styles.glassCardColumn}>
            <Text style={styles.settingInputLabel}>Your Name</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Sanat"
              placeholderTextColor="#4B5563"
              value={userName}
              onChangeText={setUserName}
            />
            <Text style={styles.inputTip}>How the assistant will address you.</Text>
          </View>

          <View style={styles.glassCardColumn}>
            <Text style={styles.settingInputLabel}>Gmail Address</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. user@gmail.com"
              placeholderTextColor="#4B5563"
              keyboardType="email-address"
              autoCapitalize="none"
              value={userEmail}
              onChangeText={setUserEmail}
            />
            <Text style={styles.inputTip}>Used by the Email Agent to read and summarize inbox.</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SYSTEM CONTROL</Text>
          <View style={styles.glassCardRow}>
            <View>
              <Text style={styles.settingLabel}>Always-On Wake-Word</Text>
              <Text style={styles.settingDesc}>Listens for "Night" in the background</Text>
            </View>
            <Switch
              value={isWakeWordActive}
              onValueChange={setIsWakeWordActive}
              trackColor={{ false: "#1E1F29", true: "#6366F1" }}
              thumbColor={isWakeWordActive ? "#FFFFFF" : "#9CA3AF"}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>INTEGRATIONS</Text>
          
          <View style={styles.glassCardRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.integrationName}>Spotify Music</Text>
              <Text style={styles.settingDesc}>Control audio playback & search playlists</Text>
            </View>
            <TouchableOpacity
              onPress={() => setIsSpotifyConnected(!isSpotifyConnected)}
              style={[
                styles.connectBtn,
                isSpotifyConnected ? styles.connectedBtn : styles.disconnectedBtn,
              ]}
            >
              <Text style={styles.connectBtnText}>
                {isSpotifyConnected ? "Connected" : "Connect"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.glassCardRow, { marginTop: 12 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.integrationName}>Google Calendar</Text>
              <Text style={styles.settingDesc}>Query agendas & create scheduling tasks</Text>
            </View>
            <TouchableOpacity
              onPress={handleGoogleConnect}
              style={[
                styles.connectBtn,
                isGoogleConnected ? styles.connectedBtn : styles.disconnectedBtn,
              ]}
            >
              <Text style={styles.connectBtnText}>
                {isGoogleConnected ? "Connected" : "Connect"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity onPress={handleSave} style={styles.saveBtn}>
          <Text style={styles.saveBtnText}>Save Configurations</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0E15",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  backButton: {
    width: 60,
  },
  backText: {
    color: "#6366F1",
    fontSize: 14,
    fontWeight: "600",
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#FFFFFF",
    letterSpacing: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 45,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#6366F1",
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  glassCardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
  },
  glassCardColumn: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    marginBottom: 12,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  settingDesc: {
    fontSize: 11,
    color: "#6B7280",
    marginTop: 2,
  },
  settingInputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#D1D5DB",
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: "#08090D",
    borderColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#FFFFFF",
    fontSize: 14,
  },
  inputTip: {
    fontSize: 10,
    color: "#4B5563",
    marginTop: 6,
  },
  integrationName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  connectBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  disconnectedBtn: {
    backgroundColor: "#1F2937",
  },
  connectedBtn: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
  },
  connectBtnText: {
    fontSize: 12,
    color: "#FFFFFF",
    fontWeight: "600",
  },
  saveBtn: {
    backgroundColor: "#6366F1",
    borderRadius: 12,
    paddingVertical: 14,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
    shadowColor: "#6366F1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  saveBtnText: {
    color: "#FFFFFF",
    fontWeight: "bold",
    fontSize: 15,
    letterSpacing: 1.5,
  },
});
