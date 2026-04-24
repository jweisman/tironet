"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Cake } from "lucide-react";
import { useQuery } from "@powersync/react";

// Soldiers whose date_of_birth month/day matches today
// strftime('%m-%d', ...) extracts MM-DD from the stored date string
const BIRTHDAY_QUERY = `
  SELECT s.id, s.given_name, s.family_name, s.date_of_birth
  FROM soldiers s
  WHERE s.cycle_id = ?
    AND s.status = 'active'
    AND s.date_of_birth IS NOT NULL
    AND strftime('%m-%d', s.date_of_birth) = strftime('%m-%d', 'now')
    AND (? = '' OR s.squad_id = ?)
  ORDER BY s.family_name ASC, s.given_name ASC
`;

interface RawBirthday {
  id: string;
  given_name: string;
  family_name: string;
  date_of_birth: string;
}

function computeAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

interface Props {
  cycleId: string;
  squadId: string;
}

export function BirthdayCallout({ cycleId, squadId }: Props) {
  const params = useMemo(() => [cycleId, squadId, squadId], [cycleId, squadId]);
  const { data: birthdays } = useQuery<RawBirthday>(BIRTHDAY_QUERY, params);

  if (!birthdays || birthdays.length === 0) return null;

  return (
    <div className="space-y-2">
      {birthdays.map((b) => {
        const age = computeAge(b.date_of_birth);
        return (
          <Link
            key={b.id}
            href={`/soldiers/${b.id}`}
            className="flex items-center gap-3 rounded-xl border border-pink-200 bg-pink-50/50 dark:bg-pink-950/20 dark:border-pink-800/40 px-4 py-3 transition-colors hover:bg-pink-50 active:bg-pink-100"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-pink-100 dark:bg-pink-900/40 text-pink-600 dark:text-pink-400 shrink-0">
              <Cake size={18} />
            </span>
            <p className="text-sm font-semibold flex-1 min-w-0">
              היום יום ההולדת ה-{age} ל{b.family_name} {b.given_name} 🎉
            </p>
          </Link>
        );
      })}
    </div>
  );
}
