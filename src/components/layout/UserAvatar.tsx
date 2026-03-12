"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { User } from "lucide-react";

export function UserAvatar({ size = 36 }: { size?: number }) {
  const { data: session } = useSession();
  const [profileImage, setProfileImage] = useState<string | null>(null);

  const initials = session?.user
    ? `${session.user.givenName?.[0] ?? ""}${session.user.familyName?.[0] ?? ""}`.toUpperCase()
    : "";

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/users/me")
      .then((r) => r.json())
      .then((data) => setProfileImage(data.profileImage ?? null))
      .catch(() => {});
  // Re-fetch whenever the user record is updated (profileImageVersion changes on save)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, session?.user?.profileImageVersion]);

  return (
    <Link href="/profile" aria-label="פרופיל משתמש">
      <div
        className="flex items-center justify-center rounded-full bg-primary text-primary-foreground overflow-hidden"
        style={{ width: size, height: size }}
      >
        {profileImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profileImage}
            alt="תמונת פרופיל"
            className="w-full h-full object-cover"
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
