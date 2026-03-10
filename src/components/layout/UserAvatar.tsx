"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { User } from "lucide-react";

export function UserAvatar({ size = 36 }: { size?: number }) {
  const { data: session } = useSession();
  const profileImage = session?.user?.profileImage;
  const initials = session?.user
    ? `${session.user.givenName?.[0] ?? ""}${session.user.familyName?.[0] ?? ""}`.toUpperCase()
    : "";

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
