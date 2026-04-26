"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { toast } from "sonner";

interface UserPreferences {
  showTour: boolean;
}

interface UserPreferenceContextValue extends UserPreferences {
  loaded: boolean;
  updatePreference: (
    field: keyof UserPreferences,
    value: boolean,
  ) => Promise<void>;
}

const defaults: UserPreferences = { showTour: true };

const UserPreferenceContext = createContext<UserPreferenceContextValue>({
  ...defaults,
  loaded: false,
  updatePreference: async () => {},
});

export function UserPreferenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [prefs, setPrefs] = useState<UserPreferences>(defaults);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/user-preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setPrefs({ showTour: data.showTour });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const updatePreference = useCallback(
    async (field: keyof UserPreferences, value: boolean) => {
      const prev = prefs[field];
      setPrefs((p) => ({ ...p, [field]: value }));

      const res = await fetch("/api/user-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });

      if (!res.ok) {
        setPrefs((p) => ({ ...p, [field]: prev }));
        toast.error("שגיאה בשמירת העדפות");
      }
    },
    [prefs],
  );

  return (
    <UserPreferenceContext.Provider
      value={{ ...prefs, loaded, updatePreference }}
    >
      {children}
    </UserPreferenceContext.Provider>
  );
}

export function useUserPreferences() {
  return useContext(UserPreferenceContext);
}
