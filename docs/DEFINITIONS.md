# Definitions

This document summarizes the up-to-date definitions for terms used throughout the application.

## Activities
* _Open_: Required activities whose date is today or in the past that have gaps
* _Completed_: Activities whose date is today or in the past with no gaps
* _Future_: Activities whose date is in the future (after today)
* _Gaps_: An activity has gaps when it is required, its date is in the past, and at least one soldier is missing a report or has a failed report

## Requests
* _In progress (ממתינה)_: Status is `open` — still progressing through the approval chain
* _Active (פעילה)_: Approved, with the following conditions:
  * leave requests where the departure or return date is today or in the future
  * medical requests with any appointment date in the future
* _Approved (אושרה)_: Status is approved (terminal — workflow is complete)
* _Open (פתוחות)_: In progress or active
* _Action Required ("Mine")_: Requests where `assignedRole` matches the user's role. Includes denied requests pending acknowledgement.
* _All_: All requests regardless of status, including denied and fully completed
* _Urgent_: When request is open (active or in progress)
  * Medical - `urgent` flag
  * Hardship - `specialConditions` flag OR `urgent` flag

### Hardship (ת״ש)
Approved hardship requests are tracked separately from active requests (no date criteria). Shown on the soldiers page via a dedicated filter pill with urgent overlay when `specialConditions` or `urgent` is set.  

### Edit permissions (role-based)
Edit permissions are based on role, not workflow state:
* **Platoon commanders, platoon sergeants, company commanders, deputy company commanders** — can edit and delete all request types
* **Company medic** — can edit and delete medical requests only
* **Hardship coordinator** — can edit and delete hardship requests only
* **Squad commanders, instructors** — cannot edit or delete requests

Editing is done via a modal dialog for core request fields. Medical appointments and sick days have separate inline editing sections.

### Delete permissions
* Same roles as edit permissions (above)
* Request creators can always delete their own requests
* Only open requests (with `assignedRole !== null`) can be deleted


## Roles
* _Squad commander_:
  * access to all soldiers in their squad
  * creates requests (routed to platoon commander for approval)
  * adds activity reports
* _Platoon commander_:
  * access to all soldiers in all squads in their platoon
  * approves/denies requests
  * commanders page: manages platoon sergeant and squad commanders in their platoon
  * can invite: squad commander, platoon sergeant
  * access to reports
* _Platoon sergeant_:
  * access like platoon commander (activities, soldiers, reports)
  * for requests: treated like squad commander — creates requests routed to platoon commander, cannot act on requests assigned to platoon commander
  * commanders page: same as platoon commander
  * can invite: squad commander, platoon sergeant
* _Company commander_:
  * access to all soldiers in all platoons in their company
  * commanders page: manages all roles in their company (platoon commanders, squad commanders, instructors, medics, hardship coordinators)
  * can invite: platoon commander, platoon sergeant, squad commander, instructor, company medic, hardship coordinator
  * access to reports
* _Deputy company commander_:
  * access like company commander (including commanders page and invitation permissions)
* _Company medic_:
  * creates and edits medical requests for all soldiers in company
  * views request reports (limited to medical requests)
  * dashboard view limited to medical requests
* _Hardship coordinator_:
  * creates and edits hardship requests for all soldiers in company
  * views request reports (limited to hardship requests)
  * dashboard view limited to hardship requests
* _Instructor_:
  * creates and edits activities for any platoon in company
  * adds activity reports for any activity
  * views activity reports
  * dashboard view limited to activities
* _Admin_:
  * administers the system via the Admin section
  * no effect on scope — requires a cycle assignment like all other roles

## Incidents (אירועים)
* _Types_:
  * `commendation` (צל״ש) — positive recognition (green)
  * `discipline` (משמעת) — disciplinary issue (amber)
  * `safety` (בטיחות) — safety incident (red)
* _Subtypes_ (required, depend on type — defaults to `general`):
  * commendation: `fitness` (כושר), `teamwork` (עבודת צוות), `general` (כללי)
  * discipline: `smoking` (עישון), `reliability` (אמינות), `general` (כללי)
  * safety: `weapon` (מטווח), `general` (כללי)
* _Permissions_:
  * Any commander in the chain of command can create incidents
  * Only platoon commanders or higher can edit/delete
* _Visibility_: Scoped by chain of command (same as soldiers)
* _Surfaces_: Soldier detail page, Daily Forum report (for incidents on the report date), Personal File report

## Home Visits (ביקורי בית)
* _Statuses_:
  * `in_order` (תקין) — everything is fine
  * `deficiencies` (ליקויים) — issues found
* _Permissions_:
  * Any commander in the chain of command can create home visits
  * Only platoon commanders or higher can edit/delete
* _Visibility_: Scoped by chain of command (same as soldiers)
* _Surfaces_: Soldier detail page, Calendar