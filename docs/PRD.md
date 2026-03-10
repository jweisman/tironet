# Tironet (Application to Manage Basic Training)

## Overview
The site provides simple management and tracking for IDF training and courses. Today this is done mostly through Excel or Google Sheets which makes it difficult to track which trainees have done which activities and where there are gaps which must be filled. The purpose of this system is to centralize all data in one place and to provide commanders with a clear picture of what's happening. 

The application must be simple to use, otherwise it will not be adopted. A squad commander must be able to update an activity for the entire squad in less than 30 seconds. This may come in the form of quick updates or "update all" with the ability to quickly identify exceptions.

The final goal is to be able to see a list of deficiencies that must be addressed. For example, Yossi Cohen didn't do the firing range and failed the weapon test. That way, all of the commanders know at a glance what is missing. 

### Language
The application is available in Hebrew and must support RTL.

## Users & Roles
* Squad commanders (מ״כ): Sees the entire squad and enters results for each member of the squad
* Platoon commanders (מ״מ): Sees the entire platoon
* Company commanders (מ״פ): Sees the entire company
* Admin: Creates cycles, invites users, defines companies and platoons

### Commander transfers
Multiple commanders should be able to be assigned to each hierarchy to handle transfers mid-cycle. 

### Hierarchy
The app must support a training cycle (מחזור) as the highest level, then company, platoon, and squad.

### Invitations & Authentication
Users must be invited by an admin or a user at a higher level. An admin can invite a user at any level, while a commander can invite a user at any lower level in the hierarchy.

For example: 
* An admin can invite a מ״פ or a מ״מ. 
* The מ״פ can invite מ״מ or מ״כים
* The מ״מ can invite מ״כים. 

When users are invited they are associated with a cycle and their level in the hierarchy. I.e. a מ״כ is invited to כיתה 2 of מחלקה 1 in פלוגה בולדוג for אוג 2025. 

An invitation email is sent to the user which includes the role and association. When the user clicks the link in the email, they are taken to the site where they can log in (via Google and Magic Link in Phase 1). After authentication, they enter the application with the appropriate permissions.

Users can be associated with multiple cycles, and in each cycle they can have a different role / association. I.e. דן was a מ״כ for כיתה 2 in מרץ 25 and a מ״מ for מחלקה 1 in אוג 25.

Unauthenticated users see a landing page with the option to login. If they authenticate with an unknown email (either via Google or Magic Link) they receive a message that they are not authenticated and to talk to their commander.

### User management
In a user management screen, commanders can view all and edit users in their hierarchy. Edits must be within the hierarchy (i.e. platoon commander can change squad to another squad in the same platoon).

User invitations are also handled in the user management screen (see above)

User records contain the following properties:
* Given and Family Names
* Rank
* Type (user or admin)
* Profile picture (upload image or take picture on mobile, ability to zoom/pan/crop image)
* Email (used to log in via Google or Magic Link)
* Cycles
  * Cycle
  * Role (company, platoon, or squad commander)
  * Command (squad, platoon, or company)

Admin users can also be associated with a cycle as a commander. User type (user/admin) and cycles are separate to support this.

## Cycle Picker
When a user first goes to the app, if he is associated with multiple cycles, they are presented with a cycle picker. If the user is associated with only one cycle, they go directly to the home page. The selected cycle is remembered so that the user doesn't have to select the cycle the next time they enter the app. The user can return to the cycle picker at any time to change cycles.

## Layout
The layout of the app should support the following main tabs:
* Home (Dashboard)
* Soldiers
* Activities

The preferred layout paradigm is persistent tabs along the bottom in the mobile interface, and along the left side in desktop. But other options can be considered.

In addition, there should be a way to reach a user profile (perhaps clicking on the user avatar) and admin functionally for admin users.

## Home/Dashboard
The dashboard is personalized and shows appropriate data for each user role. The user's rank and name are displayed, along with their role for the selected cycle. 

A squad summary is shown for each squad in the user's hierarchy. Tapping the activities section brings the user to the activities tab. Tapping the gaps section brings the user to the activity report in view mode filtered on gaps (missing reports or failed) for the selected squad.

_Gaps_ are defined as any *required* activity for which a soldier has either not completed (missing activity report record) or has failed.

For example:
````
Squad Overview

Soldiers: 12

Activities
✓ Completed: 34
⚠ Missing: 6
✗ Failed: 3

Top gaps
ירי מטווח 2 – 5 missing
כש"ג 3 – 2 failed
````

## Soldiers
Soldiers are managed by each level of commander. I.e. a squad commander can manage/add soldiers in his squad, a platoon commander can manage soldiers in any squad in his platoon. The Soldier tab is a list/details form. For higher level commanders the list is organized by squad and platoon.

Soldiers can be added manually or by spreadsheet (CSV or Excel). Fields include:
* Given and Family Names
* Rank
* Profile picture (upload image or take picture on mobile, ability to zoom/pan/crop image)
* Squad (unless being managed by a squad commander, then in his squad by default without the ability to change)
* Status (active / transferred / dropped / injured)

A template spreadsheet should be provided with the supported fields.

Commanders should be able to see all soldiers in their hierarchy only. A soldier profile should provide the highlights of the soldier, including any gaps (failed, missing activities)

Option to search for a soldier by name (given/family) in the list view. Option to filter soldiers with gaps.

The soldier's profile picture is used throughout the app to help the commanders associate a name with the soldier.

## Activities (פעילויות)
Activities are the main building block for the application. 

### Activity Types
The following activity types are supported initially (but can be expanded later). Each activity type has an icon and a name:
* אימונים
* כש״ג
* ירי
* שיעורים
* בוחנים
* הסמכות
* שיחות מפקד

Activity types can be edited/added by Admins.

### Activities
An activity is added at the platoon level by a platoon commander. (For now, this feature is platoon commander only. It may be possible in the future to add activities at the company level but not in V1.) It appears for each squad in the platoon. When an activity is created, the platoon commander has an option to send an email to all of his squad commanders informing them that a new activity was added and providing a link to fill in the activity report for the activity.

An activity has the following properties:
* Activity type
* Name (i.e. כש״ג 1)
* Date (default to today)
* Required (default true; false will not create gaps)
* Status 
  * _draft_: Do not appear for activity reporting; appear only to the platoon commander who created it.
  * _active_: Appear for activity reporting

The activity list should be filterable by last week, with gaps, etc. In the list view, the activities are shown with a summary view and high level activity report details (i.e how many completed/missing). Tapping the activity brings the user to the activity details and report (see below). The list should be sortable (default date descending)

Activities data can be edited after they're created (type, name, date, status).

Activities which are missing any reports are highlighted in the activity list.

### Activity Report
Activity reports are used to record soldier's results for an activity. The report has two modes- view and edit. 

In the view mode, the result for each soldier are shown with gaps highlighted. 

The edit mode is used (mostly by) squad commanders to fill in the results for each activity and each soldier. For each soldier and activity, the squad commander reports:
* Result
  * passed
  * failed
  * N/A
* Grade (numeric, optional, no specified boundaries)
* Note (optional)

If no record is provided for a soldier for an activity, it means he has not completed the activity.

Squad commanders must be able to bulk update results for all soldiers in their squad. For example, mark all passed or failed. This action will set the value for any soldier who does not have a value already for that activity report. Then they can change values for individual soldiers on an exception basis. 

Higher level commanders can edit the activity reports for anyone in their hierarchy. 

If a soldier comes into a training cycle late (i.e. is added after activities already exist for that squad for that cycle), the commander should be able to mark previous activities as N/A. The system should prompt the user to automatically mark all previous activities as N/A for the new soldier.

Activity reports are related to a soldier and cycle. If the soldier changes squad later, the activity reports move with him. A soldier can be a member of one squad at a time for each cycle.

Only the latest result is saved (i.e. if a test was failed and then passed, only the passing grade it stored)

## Admin features
* _Cycle management_: Admins can create cycles and mark them as inactive, after which they do not appear in the cycle picker at all. Inactive cycles can be reactivated.
* _User management_: Admins can manage and invite users at any level
* _Command Structure_: Admins can create companies, platoons, and squads. Each has a name and a parent.
* _Activity Types_: Admins can manage activity types
  * Add new types (name and icon)
  * Edit types (name, icon, status)
  * Inactive activity types can't be selected for new activities, but all previous activity remains.

## Future Additions
* Export to Excel
* Activity scheduling via calendar
* Audit log
* Activity templates
* Multiple activity results per soldier
* Missing report notifications

## Success criteria
* Squad activity updated in 30 seconds
* 90% of activities reported within 24 hours
* Commanders log in twice weekly

## Non-Functional Requirements
* The app must be built *mobile first* and *offline first*. A local database should use used with a synchronization system to synchronize with the server when connected (i.e Postgres with PowerSync or some other viable solution)
  * In general last write should win. 
  * Use patch where possible to limit conflicts
  * Authentication can happen on-line, with a token stored locally to maintain the user's session 
* The app should be a PWA to enable a broad reach without the need to install from the app store
* The app is only available in Hebrew for version 1. Consider whether an internationalization system should be used to extract strings to files, or if they can be embedded for phase 1.
* All entities should have system IDs
* Profile images should be optimized client side and saved as a blob / base64 in the soldier record
* Optimized for mobile first but can also be used on desktop
* Technology stack:
  * Next.js and TS for website (NextAuth for authentication)
  * Postgres for DB (hosted service for production)
  * SMTP for email sending
* Pages load in < 2 seconds
* Site should be built to be cloud deployed (sensitive data in environment, etc.)