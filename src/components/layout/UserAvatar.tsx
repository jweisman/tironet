"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { User } from "lucide-react";

/** Custom event fired by the profile page after a successful image upload. */
export const PROFILE_IMAGE_UPDATED_EVENT = "profileImageUpdated";

export function UserAvatar({ size = 36 }: { size?: number }) {
  const { data: session } = useSession();
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  const initials = session?.user
    ? `${session.user.givenName?.[0] ?? ""}${session.user.familyName?.[0] ?? ""}`.toUpperCase()
    : "";

  const fetchImage = useCallback(() => {
    if (!session?.user?.id) return;
    fetch("/api/users/me")
      .then((r) => r.json())
      .then((data) => {
        setProfileImage(data.profileImage ?? null);
        setImgError(false);
      })
      .catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => {
    fetchImage();
  // Re-fetch whenever the user record is updated (profileImageVersion changes on save)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchImage, session?.user?.profileImageVersion]);

  // Listen for direct profile image updates (e.g. from the profile page)
  useEffect(() => {
    function onProfileImageUpdated(e: Event) {
      const detail = (e as CustomEvent<string | null>).detail;
      setProfileImage(detail);
      setImgError(false);
    }
    window.addEventListener(PROFILE_IMAGE_UPDATED_EVENT, onProfileImageUpdated);
    return () => window.removeEventListener(PROFILE_IMAGE_UPDATED_EVENT, onProfileImageUpdated);
  }, []);

  const showImage = profileImage && !imgError;

  return (
    <Link href="/profile" aria-label="פרופיל משתמש">
      <div
        className="flex items-center justify-center rounded-full bg-primary text-primary-foreground overflow-hidden"
        style={{ width: size, height: size }}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profileImage}
            alt="תמונת פרופיל"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : initials ? (
          <span className="text-sm font-medium leading-none">{initials}</span>
        ) : (
          <User size={size * 0.55} />
        )}
      </div>
    </Link>
  );
}
