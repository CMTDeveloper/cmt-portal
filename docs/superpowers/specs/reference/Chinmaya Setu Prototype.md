# Chinmaya Setu

# The Purpose

# **Chinmaya Setu** is an application that will be used by various groups associated with Chinmaya Mission Toronto.

# ***Chinmaya:** Directly references the mission, establishing its connection to the app.*

# ***Setu:** In Sanskrit, "Setu" means "bridge," symbolizing the app's role as a bridge between students, educational resources, and the mission's goals. This resonates with Chinmaya Mission's emphasis on building knowledge and spiritual understanding.*

**Phase 1**  a simple web app that will allow families and guests to self check-in as they enter the Ashram. This will also mark attendance for students. This app will only be accessible at the Ashram and will be kept open at the entry point.

**Phase 2**  A mobile app. The main purpose of the app will be for teachers to take/verify attendance, take class notes, and provide visibility to various analytics to manage the classes. This phase will provide same functionality as the current attendance app (Appsheet)

**Phase 3**  Extend the app to families, to enroll into various programs such as OM Chanting, Gita Chanting, etc. Receive weekly class updates from teachers, and direct communication with teachers. Pre-record absence and keep track of all activities kids enrolled in at CMT.

**Phase 4**  At this phase, retire the existing registration portal. Primary way for existing and new families to join the mission, and use apps as one stop for any engagement. Stripe integration for handling payments for annual registrations and various programs & donations.

# Requirements

**Phase 1**  the main purpose of the app will be for teachers to take attendance & notes, and various analytics to manage the classes. This phase will provide same functionality as the current attendance app (Appsheet)

- REQ1: Access controls  
- REQ2: Class list  
- REQ3: Attendance  
- REQ4: Notes/remarks for students   
- REQ5: On-prem visitors list  
- REQ6: Analytics

# Architecture

Web based application (Progressive Web App) vs. Native App

Frontend   		NextJS (React), Tailwind CSS (with Flowbite)  
Hosting  		Vercel with firebase  
Authentication  	NextAuth or Supabase  
Database  		Firebase  
Push Notifications  	Firebase Cloud Messaging  
Emails  		AWS SES  
Storage  		Amazon S3 or Google Drive

**Samples**  
[https://flowbite-admin-dashboard.vercel.app/crud/users/](https://flowbite-admin-dashboard.vercel.app/crud/users/) 


| Sidebar drawer with key links User menu with profile setting links, sign out, and Switch Role functionality to change role between Parent vs Teacher, etc. |     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |




# Functions & user groups

- **Coordinator Team**  
  - See full roster for any campus (i.e. Brampton, Scarborough, etc.)  
  - Some reporting  tbd
- **Families and Students**  
  - Manage families and students  families can register and manage members  
  - Student enrollment to classes  students are automatically enrolled based on school grade/age  
  - Student enrollment to various programs    
    - Family can choose and enroll to available programs as well as manage enrollment  
    - Notifications when new programs are made available,   
    - Programs to be available based on level
  - Family member enrollment to various programs  
    - Notifications when new programs are made available
- **Teachers**  
  - Be able to switch role in app to act as Teacher or Parent  
  - Take weekly attendance, notes for each students  
  - Weekly class notes  
  - Send message to families or individuals within class roster  
  - See program enrollment for each students
- **Welcome & Registration Team**  
  - Be able to switch role in app to act as Sevak or Parent  
  - See entire roster  
  - Register on-behalf of new families
- **Program Leads**  
  - Be able to switch role in app to act as Sevak or Parent  
  - Create and manage programs & enrollments

# Notifications


|          | Phase 1                                                             | Phase 2 | Phase 3 |
| -------- | ------------------------------------------------------------------- | ------- | ------- |
| Teachers | Monday and Friday if attendance is not taken or less than 80% taken |         |         |
|          |                                                                     |         |         |


# Brain Dump of Questions

1. How will we store documentation? Confluence?
2. How will we track tasks for software development? JIRA?

Scanner programming barcode:

