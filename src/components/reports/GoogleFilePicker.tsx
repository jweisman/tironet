"use client";

import { useEffect, useRef, useCallback } from "react";

declare global {
  interface Window {
    gapi: {
      load: (api: string, callback: () => void) => void;
    };
    google: {
      picker: {
        PickerBuilder: new () => PickerBuilder;
        ViewId: { SPREADSHEETS: string };
        Action: { PICKED: string; CANCEL: string };
        Feature: { NAV_HIDDEN: string };
      };
    };
  }
}

interface PickerBuilder {
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (appId: string) => PickerBuilder;
  addView: (view: string) => PickerBuilder;
  setCallback: (cb: (data: PickerResponse) => void) => PickerBuilder;
  enableFeature: (feature: string) => PickerBuilder;
  setTitle: (title: string) => PickerBuilder;
  setLocale: (locale: string) => PickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}

interface PickerResponse {
  action: string;
  docs?: { id: string; name: string }[];
}

interface Props {
  onSelect: (file: { id: string; name: string }) => void;
  onCancel: () => void;
  onError: (error: string) => void;
}

const GAPI_SCRIPT_ID = "google-picker-gapi";

function loadGapiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.gapi) {
      resolve();
      return;
    }
    if (document.getElementById(GAPI_SCRIPT_ID)) {
      // Script is loading, wait for it
      const check = setInterval(() => {
        if (window.gapi) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      return;
    }
    const script = document.createElement("script");
    script.id = GAPI_SCRIPT_ID;
    script.src = "https://apis.google.com/js/api.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google API"));
    document.head.appendChild(script);
  });
}

function loadPicker(): Promise<void> {
  return new Promise((resolve) => {
    window.gapi.load("picker", () => resolve());
  });
}

export function GoogleFilePicker({ onSelect, onCancel, onError }: Props) {
  const initialized = useRef(false);

  const openPicker = useCallback(async () => {
    try {
      // 1. Load gapi + picker library
      await loadGapiScript();
      await loadPicker();

      // 2. Get access token from server
      const tokenRes = await fetch("/api/reports/google/access-token");
      const tokenData = await tokenRes.json();
      if (tokenData.needsAuth) {
        onError("needsAuth");
        return;
      }
      if (!tokenData.accessToken) {
        onError("Failed to get access token");
        return;
      }

      // 3. Build and show picker
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;
      const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;
      if (!apiKey) {
        onError("Google Picker API key not configured");
        return;
      }

      let builder = new window.google.picker.PickerBuilder()
        .setOAuthToken(tokenData.accessToken)
        .setDeveloperKey(apiKey)
        .addView(window.google.picker.ViewId.SPREADSHEETS);

      // setAppId is required for drive.file scope — it registers the selected
      // file as "opened by this app", granting the app read/write access.
      if (appId) builder = builder.setAppId(appId);

      const picker = builder
        .enableFeature(window.google.picker.Feature.NAV_HIDDEN)
        .setTitle("בחר קובץ Google Sheets")
        .setLocale("iw")
        .setCallback((data: PickerResponse) => {
          if (data.action === window.google.picker.Action.PICKED && data.docs?.[0]) {
            onSelect({ id: data.docs[0].id, name: data.docs[0].name });
          } else if (data.action === window.google.picker.Action.CANCEL) {
            onCancel();
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err) {
      console.error("Google Picker error:", err);
      onError("שגיאה בפתיחת Google Drive");
    }
  }, [onSelect, onCancel, onError]);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      openPicker();
    }
  }, [openPicker]);

  return null;
}
