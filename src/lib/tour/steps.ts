import type { DriveStep } from "driver.js";

/** A tour step with an optional version number (defaults to 1). */
export interface VersionedStep extends DriveStep {
  /** Version number for this step. Steps with version > stored version are treated as "new". Defaults to 1. */
  version?: number;
}

// ---------------------------------------------------------------------------
// Home page tour
// ---------------------------------------------------------------------------
export const homeTourSteps: VersionedStep[] = [
  {
    popover: {
      title: "ברוכים הבאים לטירונט!",
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
    element: "[data-tour='home-active-requests']",
    popover: {
      title: "בקשות פעילות להיום",
      description:
        "חיילים שנמצאים ביציאה או עם תור רפואי היום. לחצו על בקשה כדי לצפות בפרטים.",
    },
  },
  {
    element: "[data-tour='home-today-activities']",
    popover: {
      title: "פעילויות היום",
      description:
        "פעילויות שמתוכננות להיום עם מד התקדמות הדיווח. לחצו כדי לעבור לדיווח.",
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
    element: "[data-tour='home-platoon-card']",
    popover: {
      title: "כרטיס מחלקה",
      description:
        "סיכום מחלקה — כלל החיילים, הפעילויות, הבקשות והפערים מכל הכיתות.",
    },
  },
  {
    element: "[data-tour='home-stats-soldiers']",
    popover: {
      title: "חיילים",
      description:
        "מספר החיילים וכמה מהם עם פערים. לחצו כדי לעבור לדף החיילים.",
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
        "מספר הבקשות הפעילות ושנמצאות בטיפול. לחצו כדי לעבור לדף הבקשות.",
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
  {
    element: "[data-tour='user-avatar']",
    popover: {
      title: "פרופיל",
      description:
        "לחצו על התמונה כדי לעבור לדף הפרופיל — עדכון פרטים, תמונה והגדרות התראות.",
    },
  },
  // v2 — new features
  {
    element: "[data-tour='user-avatar']",
    popover: {
      title: "תזכורות לתורים ויציאות",
      description:
        "הגדירו תזכורת אוטומטית לפני תורים רפואיים ושעות יציאה. לחצו על הפרופיל ועברו להגדרות התראות.",
    },
    version: 2,
  },
  {
    element: "[data-tour='nav-calendar']",
    popover: {
      title: "לוח אירועים",
      description:
        "לוח חודשי עם כל הפעילויות, היציאות, התורים וימי המחלה. ניתן לסנן ולייצא ל-PDF.",
    },
    version: 2,
  },
  {
    element: "[data-tour='nav-more']",
    popover: {
      title: "לוח אירועים",
      description:
        "לחצו על ׳עוד׳ כדי למצוא את לוח האירועים — לוח חודשי עם פעילויות, יציאות, תורים וימי מחלה.",
    },
    version: 2,
  },
];

// ---------------------------------------------------------------------------
// Soldiers page tour
// ---------------------------------------------------------------------------
export const soldiersTourSteps: VersionedStep[] = [
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
export const activitiesTourSteps: VersionedStep[] = [
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
  // v2 — new features
  {
    element: "[data-tour='activities-multiselect-btn']",
    popover: {
      title: "עריכה מרובה",
      description:
        "בחרו מספר פעילויות ועדכנו סטטוס, תאריך או מחקו אותן בבת אחת.",
    },
    version: 2,
  },
];

// ---------------------------------------------------------------------------
// Requests page tour
// ---------------------------------------------------------------------------
export const requestsTourSteps: VersionedStep[] = [
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
      title: "בקשות ממתינות",
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

// ---------------------------------------------------------------------------
// Soldier detail page tour
// ---------------------------------------------------------------------------
export const soldierDetailTourSteps: VersionedStep[] = [
  {
    element: "[data-tour='soldier-header']",
    popover: {
      title: "פרטי חייל",
      description: "כאן תראו את הפרטים האישיים של החייל — שם, דרגה, סטטוס ופרטי קשר.",
    },
  },
  {
    element: "[data-tour='soldier-avatar']",
    popover: {
      title: "תמונת חייל",
      description: "לחצו על התמונה כדי להגדיל ולראות את הפנים בבירור.",
    },
  },
  {
    element: "[data-tour='soldier-edit-btn']",
    popover: {
      title: "עריכת פרטים",
      description: "לחצו כדי לערוך את הפרטים האישיים של החייל.",
    },
  },
  {
    element: "[data-tour='soldier-requests']",
    popover: {
      title: "בקשות",
      description: "כל הבקשות של החייל במחזור הנוכחי. לחצו על בקשה כדי לצפות בפרטים, או צרו בקשה חדשה.",
    },
  },
  {
    element: "[data-tour='soldier-gaps']",
    popover: {
      title: "פעילויות עם פערים",
      description: "פעילויות שהחייל נכשל בהן או חסר דיווח. לחצו כדי לעבור לפעילות.",
    },
  },
  {
    element: "[data-tour='soldier-completed']",
    popover: {
      title: "פעילויות שהושלמו",
      description: "פעילויות שהחייל השלים בהצלחה, כולל ציונים והערות.",
    },
  },
];

// ---------------------------------------------------------------------------
// Activity detail page tour
// ---------------------------------------------------------------------------
export const activityDetailTourSteps: VersionedStep[] = [
  {
    element: "[data-tour='activity-header']",
    popover: {
      title: "פרטי פעילות",
      description: "שם הפעילות, סוג, תאריך ומחלקה.",
    },
  },
  {
    element: "[data-tour='activity-edit-meta']",
    popover: {
      title: "עריכת פרטים",
      description: "ערכו את שם הפעילות, תאריך, סוג ואם היא חובה.",
    },
  },
  {
    element: "[data-tour='activity-import-reports']",
    popover: {
      title: "ייבוא דיווחים",
      description: "העלו דיווחים מקובץ Excel/CSV — מתאים לדיווח מרוכז.",
    },
  },
  {
    element: "[data-tour='activity-edit-reports']",
    popover: {
      title: "עריכת דיווח",
      description: "סמנו השתתפות (ביצע/לא ביצע) והזינו ציונים. כשלונות מסומנים אוטומטית לפי סף שהוגדר בסוג הפעילות.",
    },
    version: 2,
  },
  {
    element: "[data-tour='activity-gaps-filter']",
    popover: {
      title: "סינון פערים",
      description: "הציגו רק חיילים עם פערים — חסרי דיווח, לא ביצעו, או נכשלו בציונים.",
    },
    version: 2,
  },
  {
    element: "[data-tour='activity-soldier-row']",
    popover: {
      title: "שורת חייל",
      description: "כאן תראו את הדיווח של כל חייל — תוצאה, ציונים והערה.",
    },
  },
];

// ---------------------------------------------------------------------------
// Request detail page tour
// ---------------------------------------------------------------------------
export const requestDetailTourSteps: VersionedStep[] = [
  {
    element: "[data-tour='request-header']",
    popover: {
      title: "פרטי בקשה",
      description: "סוג הבקשה, שם החייל וסטטוס נוכחי.",
    },
  },
  {
    element: "[data-tour='request-assignment']",
    popover: {
      title: "הקצאה",
      description: "מי אחראי לטפל בבקשה כרגע. אם זה אתם — תראו התראה.",
    },
  },
  {
    element: "[data-tour='request-details']",
    popover: {
      title: "פרטי הבקשה",
      description: "כל הפרטים הרלוונטיים — תיאור, תאריכים, תורים ועוד.",
    },
  },
  {
    element: "[data-tour='request-timeline']",
    popover: {
      title: "מהלך הטיפול",
      description: "ציר הזמן של כל הפעולות — יצירה, אישור, דחייה והערות.",
    },
  },
  {
    element: "[data-tour='request-add-note']",
    popover: {
      title: "הוספת הערה",
      description: "הוסיפו הערה בכל שלב — היא תופיע בציר הזמן ותהיה גלויה לכל המפקדים בשרשרת.",
    },
  },
  {
    element: "[data-tour='request-actions']",
    popover: {
      title: "פעולות",
      description: "אשרו, דחו או אשרו קבלה של הבקשה — בהתאם לתפקידכם בשרשרת האישור.",
    },
  },
];

// ---------------------------------------------------------------------------
// Calendar page tour
// ---------------------------------------------------------------------------
export const calendarTourSteps: VersionedStep[] = [
  {
    popover: {
      title: "לוח אירועים",
      description:
        "לוח חודשי עם כל הפעילויות, היציאות, התורים וימי המחלה. לחצו על יום כדי לראות את האירועים.",
    },
  },
  {
    element: "[data-tour='calendar-filters']",
    popover: {
      title: "סינון אירועים",
      description:
        "סננו לפי מחלקה וסוג אירוע — פעילויות, יציאות או רפואה.",
    },
  },
  {
    element: "[data-tour='calendar-month-nav']",
    popover: {
      title: "ניווט חודשי",
      description: "עברו בין חודשים כדי לראות אירועים עתידיים או עבר.",
    },
  },
  {
    element: "[data-tour='calendar-grid']",
    popover: {
      title: "תצוגת לוח",
      description:
        "כל יום מציג את האירועים בצבעים לפי סוג או מחלקה. לחצו על אירוע כדי לעבור לפרטים.",
    },
  },
  {
    element: "[data-tour='calendar-export']",
    popover: {
      title: "ייצוא ל-PDF",
      description: "ייצאו את לוח האירועים כקובץ PDF — מסודר לפי חודש בפריסת נוף.",
    },
  },
];
