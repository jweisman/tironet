-- Fix-up: the initial migration incorrectly set failed=true for ALL old
-- "failed" reports. Old "failed" meant "didn't participate" for activity
-- types without score thresholds — those should be result='skipped', failed=false.
-- Only reports on activity types with a configured failureThreshold should
-- remain as result='completed', failed=true.

-- Reset reports where the activity type has no failureThreshold configured
UPDATE "activity_reports"
SET result = 'skipped', failed = false
WHERE failed = true
  AND activity_id IN (
    SELECT a.id FROM activities a
    JOIN activity_types t ON t.id = a.activity_type_id
    WHERE t.score_config IS NULL
       OR NOT (t.score_config ? 'failureThreshold')
       OR t.score_config->>'failureThreshold' IS NULL
  );
