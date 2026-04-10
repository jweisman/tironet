# Definitions

This document summarizes the up-to-date definitions for terms used throughout the application.

## Activities
* _Open_: Activities with date < tomorrow with gaps
* _Completed_: Activities with date < tomorrow with no gaps
* _Future_: Activities with date > today
* _Gaps_: any *required* activity whose date is in the past and for which there are missing activity reports or failed reports

## Requests
* _Open_: status open (not finished with approval chain)
* _Active_: Approved, with the following conditions:
  * leave requests with today > start date or < end date
  * medical with any appointment date in the future
  * hardship requests
* _Approved_: status approved
* _Action Required ("Mine")_: - assigned to my role
* _All_: includes declined

## Roles
* _Squad commander_:
  * access to all soldiers in his squad
  * created requests
  * adds activity reports
* _Platoon commander_:
  * access to all soldiers in all squads in his platoon
  * approves requests
  * access to reports and commanders 
* _Platoon sergeant_:
  * access like platoon commander
  * creates requests that go to platoon commander for approval (like squad commander)
* _Company commander_:
  * access to all soldiers in all platoons in his company
  * approves medical and leave requests
  * access to reports and commanders 
* _Deputy company commander_:
  * access like company commander
* _Company medic_:
  * create, edit medical requests for all soldiers in company
  * view request reports (limited to medical requests)
* _Instructor_:
  * create activities for any platoon in company
  * add activity reports for any activity
  * view activity reports