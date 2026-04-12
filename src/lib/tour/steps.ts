import type { DriveStep } from "driver.js";

// ---------------------------------------------------------------------------
// Home page tour
// ---------------------------------------------------------------------------
export const homeTourSteps: DriveStep[] = [
  {
    popover: {
      title: "!ברוכים הבאים לטירונט",
      description:
        "מערכת נוחה לניהול בקשות ופעילויות טירונים. בואו נכיר את דף הבית.",
    },
  },
  {
    element: "[data-tour='home-request-callout']",
    popover: {
      title: "בקשות ממתינות",
      description:
        "כאן תראו כמה בקשות ממתינות לטיפולכם. לחצו כדי לעבור ישירות אליהן.",
    },
  },
  {
    element: "[data-tour='home-squad-card']",
    popover: {
      title: "כרטיס כיתה",
      description:
        "כל כיתה מוצגת בכרטיס עם סיכום — חיילים, פעילויות ובקשות.",
    },
  },
  {
    element: "[data-tour='home-stats-soldiers']",
    popover: {
      title: "חיילים",
      description:
        "כאן תראו את מספר החיילים בכיתה וכמה מהם עם פערים. לחצו כדי לעבור לדף החיילים.",
    },
  },
  {
    element: "[data-tour='home-stats-activities']",
    popover: {
      title: "פעילויות",
      description:
        "כמות הפעילויות שדווחו וכמה חסרות דיווח. לחצו כדי לעבור לדף הפעילויות.",
    },
  },
  {
    element: "[data-tour='home-stats-requests']",
    popover: {
      title: "בקשות",
      description:
        "מספר הבקשות שאושרו ושנמצאות בטיפול. לחצו כדי לעבור לדף הבקשות.",
    },
  },
  {
    element: "[data-tour='home-aggregate']",
    popover: {
      title: "סיכום מחלקה",
      description:
        "שורת סיכום של כל הכיתות — כלל החיילים, הפערים, הבקשות והדיווחים.",
    },
  },
];

// ---------------------------------------------------------------------------
// Soldiers page tour
// ---------------------------------------------------------------------------
export const soldiersTourSteps: DriveStep[] = [
  {
    popover: {
      title: "דף חיילים",
      description: "כאן תראו את כל החיילים במחלקה. בואו נכיר את הכלים.",
    },
  },
  {
    element: "[data-tour='soldiers-search']",
    popover: {
      title: "חיפוש",
      description: "חפשו חייל לפי שם, מספר אישי או טלפון.",
    },
  },
  {
    element: "[data-tour='soldiers-status-filters']",
    popover: {
      title: "סינון לפי סטטוס",
      description: "סננו חיילים לפי סטטוס — פעילים, כולם, וכו'.",
    },
  },
  {
    element: "[data-tour='soldiers-requests-filter']",
    popover: {
      title: "בקשות פעילות",
      description: "הציגו רק חיילים שיש להם בקשות פעילות (מאושרות או בטיפול).",
    },
  },
  {
    element: "[data-tour='soldiers-gaps-filter']",
    popover: {
      title: "פערים",
      description: "הציגו רק חיילים עם פערים בפעילויות.",
    },
  },
  {
    element: "[data-tour='soldiers-add-btn']",
    popover: {
      title: "הוספת חייל",
      description: "הוסיפו חייל חדש ידנית על ידי מילוי הפרטים.",
    },
  },
  {
    element: "[data-tour='soldiers-import-btn']",
    popover: {
      title: "ייבוא חיילים",
      description:
        "העלו טבלת חיילים מקובץ Excel/CSV להוספה מרוכזת.",
    },
  },
  {
    element: "[data-tour='soldiers-card']",
    popover: {
      title: "כרטיס חייל",
      description:
        "לחצו על חייל כדי לצפות בפרטים — פרטים אישיים, בקשות, פעילויות ופערים.",
    },
  },
];

// ---------------------------------------------------------------------------
// Activities page tour
// ---------------------------------------------------------------------------
export const activitiesTourSteps: DriveStep[] = [
  {
    popover: {
      title: "דף פעילויות",
      description:
        "כאן תנהלו את כל הפעילויות — יצירה, דיווח וסינון.",
    },
  },
  {
    element: "[data-tour='activities-filters']",
    popover: {
      title: "סינון פעילויות",
      description:
        "סננו לפי סטטוס — פתוחות, הושלמו, עם פערים, עתידיות או טיוטה.",
    },
  },
  {
    element: "[data-tour='activities-sort']",
    popover: {
      title: "מיון",
      description: "מיינו את הפעילויות לפי תאריך, שם, או פערים.",
    },
  },
  {
    element: "[data-tour='activities-add-btn']",
    popover: {
      title: "הוספת פעילות",
      description:
        "צרו פעילות חדשה. תוכלו ליצור כטיוטה (תכנון עתידי) או כפעילה מיידית.",
    },
  },
  {
    element: "[data-tour='activities-import-btn']",
    popover: {
      title: "ייבוא פעילויות",
      description: "העלו רשימת פעילויות מקובץ Excel/CSV.",
    },
  },
  {
    element: "[data-tour='activities-card']",
    popover: {
      title: "כרטיס פעילות",
      description:
        "לחצו על פעילות כדי לצפות בפרטים, לערוך או לדווח על חיילים. פעילות שהושלמה וללא פערים עוברת אוטומטית להושלמו.",
    },
  },
];

// ---------------------------------------------------------------------------
// Requests page tour
// ---------------------------------------------------------------------------
export const requestsTourSteps: DriveStep[] = [
  {
    popover: {
      title: "דף בקשות",
      description:
        "כאן תנהלו בקשות עבור החיילים — יציאה, רפואה ותש.",
    },
  },
  {
    element: "[data-tour='requests-tab-open']",
    popover: {
      title: "בקשות פתוחות",
      description:
        "בקשות שטרם אושרו או נדחו — ממתינות לטיפול.",
    },
  },
  {
    element: "[data-tour='requests-tab-active']",
    popover: {
      title: "בקשות פעילות",
      description:
        "בקשות שאושרו והטיפול בהן נמשך — יציאות עתידיות, תורים רפואיים ותש.",
    },
  },
  {
    element: "[data-tour='requests-tab-mine']",
    popover: {
      title: "דורשות טיפולי",
      description:
        "בקשות שדורשות את אישורכם או שצריכות טיפול מיידי מצדכם.",
    },
  },
  {
    element: "[data-tour='requests-type-filters']",
    popover: {
      title: "סינון לפי סוג",
      description:
        "סננו לפי סוג בקשה — יציאה, רפואה או תש.",
    },
  },
  {
    element: "[data-tour='requests-add-btn']",
    popover: {
      title: "בקשה חדשה",
      description: "צרו בקשה חדשה עבור חייל — יציאה, רפואה או תש.",
    },
  },
  {
    element: "[data-tour='requests-card']",
    popover: {
      title: "כרטיס בקשה",
      description:
        "לחצו על בקשה כדי לצפות בפרטים, להוסיף הערות או לבצע פעולות (אישור/דחייה).",
    },
  },
];
