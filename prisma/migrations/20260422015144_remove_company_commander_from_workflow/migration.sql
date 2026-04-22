-- Migrate requests currently assigned to company_commander.
-- These are open requests that were approved by the platoon commander and
-- forwarded to the company commander for second-level approval.
-- Mark them as approved and assign to squad_commander for acknowledgement.
UPDATE requests
SET status = 'approved',
    assigned_role = 'squad_commander',
    updated_at = NOW()
WHERE assigned_role = 'company_commander';