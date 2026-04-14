# Definitions

This document summarizes the up-to-date definitions for terms used throughout the application.

## Activities
* _Open_: Required activities whose date is today or in the past that have gaps
* _Completed_: Activities whose date is today or in the past with no gaps
* _Future_: Activities whose date is in the future (after today)
* _Gaps_: An activity has gaps when it is required, its date is today or in the past, and at least one soldier is missing a report or has a failed report

## Requests
* _In progress (ממתינה)_: Status is `open` — still progressing through the approval chain
* _Active (פעילה)_: Approved, with the following conditions:
  * leave requests where the departure or return date is today or in the future
  * medical requests with any appointment date in the future
  * hardship requests (always active once approved)
* _Approved (אושרה)_: Status is approved (terminal — workflow is complete)
* _Open (פתוחות)_: In progress or active
* _Action Required ("Mine")_: Requests where `assignedRole` matches the user's role. Includes denied requests pending acknowledgement.
* _All_: All requests regardless of status, including denied and fully completed
* _Urgent_: When request is open (active or in progress)
  * Medical - `urgent` flag
  * Hardship - `specialConditions` flag OR `urgent` flag

## Roles
* _Squad commander_:
  * access to all soldiers in their squad
  * creates requests (routed to platoon commander for approval)
  * adds activity reports
* _Platoon commander_:
  * access to all soldiers in all squads in their platoon
  * approves/denies requests
  * manages squad commanders
  * access to reports
* _Platoon sergeant_:
  * access like platoon commander (activities, soldiers, reports)
  * for requests: treated like squad commander — creates requests routed to platoon commander, cannot act on requests assigned to platoon commander
* _Company commander_:
  * access to all soldiers in all platoons in their company
  * approves/denies medical and leave requests (second level after platoon commander)
  * manages squad commanders
  * access to reports
* _Deputy company commander_:
  * access like company commander
* _Company medic_:
  * creates and edits medical requests for all soldiers in company
  * views request reports (limited to medical requests)
  * dashboard view limited to medical requests
* _Instructor_:
  * creates and edits activities for any platoon in company
  * adds activity reports for any activity
  * views activity reports
  * dashboard view limited to activities
* _Admin_:
  * administers the system via the Admin section
  * no effect on scope — requires a cycle assignment like all other roles