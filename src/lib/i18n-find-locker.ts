// i18n dictionary for the public Locker Inquiry (/find-locker) page.
// Keep all user-facing strings for the page + its help menu / forms here so
// translations are easy to review and edit in one file.
import { useEffect, useState } from "react";

export type Lang = "en" | "bm";

const STORAGE_KEY = "locker-inquiry-lang";

function detectDefaultLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "bm") return stored;
  } catch { /* ignore */ }
  const nav = (typeof navigator !== "undefined" && navigator.language) || "";
  return /^ms\b|^id\b/i.test(nav) ? "bm" : "en";
}

/** Small hook: current language + setter that persists to localStorage. */
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => { setLang(detectDefaultLang()); }, []);
  const set = (l: Lang) => {
    setLang(l);
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  };
  return [lang, set];
}

type Dict = {
  pageTitle: string;
  pageSubtitle: string;
  languageLabel: string;
  officeHours: {
    heading: string;
    hours: string;
    outside: string;
  };
  lookup: {
    cardTitle: string;
    lockerNumber: string;
    lockerNumberHint: string;
    badge: string;
    nidLast4: string;
    nidLast4Hint: string;
    submit: string;
    privacyNote: string;
    resultTitle: string;
    resultName: string;
    resultBadge: string;
    resultLocker: string;
    requestTransfer: string;
    noMatch: string;
    tooMany: string;
    cantFindCta: string;
    multipleHeading: (n: number) => string;
  };
  helpMenu: {
    heading: string;
    back: string;
    lockerInquiry: { label: string; sub: string };
    cantFind: { label: string; sub: string };
    other: { label: string; sub: string };
    ticket: { label: string; sub: string };
  };
  ticket: {
    intro: string;
    ticketNumber: string;
    badge: string;
    ticketPlaceholder: string;
    submit: string;
  };
  transferPanel: {
    intro: string;
    submitLabel: string;
    messageLabel: string;
    messagePlaceholder: string;
  };
  cantFindPanel: {
    tryFirst: string;
    tip1: string;
    tip2: string;
    tip3: string;
    contactCta: string;
    formIntro: string;
    messageLabel: string;
    messagePlaceholder: string;
    submitLabel: string;
    defaultMessage: string;
  };
  otherPanel: {
    intro: string;
    orHuman: string;
    messageLabel: string;
    messagePlaceholder: string;
    submitLabel: string;
  };
  form: {
    fullName: string;
    badge: string;
    contact: string;
    contactPlaceholder: string;
    lockerOptional: string;
    errName: string;
    errBadge: string;
    errContact: string;
    errMessage: string;
    errLocker: string;
    errTooMany: string;
    errGeneric: string;
    errOpenTicket: (ref: string, status: string) => string;
    errOpenTicketCta: string;
    statusNew: string;
    statusInProgress: string;
    okHeading: string;
    okTicket: string;
    okSaveNumber: string;
    okCheckStatus: string;
    copyReference: string;
    copiedReference: string;
    submitting: string;
  };
  faq: {
    ask: string;
    placeholder: string;
    thinking: string;
    notHelpful: string;
    sendHuman: string;
    cancel: string;
    escalateHeading: string;
    yourQuestion: string;
    moreDetail: string;
    unavailable: string;
    disclaimer: string;
    you: string;
    assistant: string;
  };
};

export const t: Record<Lang, Dict> = {
  en: {
    pageTitle: "Locker Inquiry",
    pageSubtitle: "Enter your details to look up your assigned locker.",
    languageLabel: "Language",
    officeHours: {
      heading: "Admin office hours",
      hours: "Monday – Friday, 8:00 AM – 5:15 PM",
      outside: "Requests outside office hours are handled the next business day.",
    },
    lookup: {
      cardTitle: "Locker lookup",
      lockerNumber: "Locker number (optional)",
      lockerNumberHint: "If you know it, e.g. A-023",
      badge: "Badge number",
      nidLast4: "Last 4 digits of National ID (optional)",
      nidLast4Hint: "Helps us match you if there are duplicates.",
      submit: "Find my locker",
      privacyNote: "Your details are used only to look up your assigned locker.",
      resultTitle: "Your locker",
      resultName: "Name",
      resultBadge: "Badge",
      resultLocker: "Locker",
      requestTransfer: "Request locker transfer",
      noMatch: "No matching record found. Please check your details or contact the admin office.",
      tooMany: "Too many attempts. Please try again in a few minutes.",
      cantFindCta: "Can't find your locker? Contact us",
      multipleHeading: (n: number) => `You have ${n} lockers assigned:`,
    },
    helpMenu: {
      heading: "How can we help you?",
      back: "Back to menu",
      lockerInquiry: { label: "Locker Inquiry", sub: "Look up your locker or request a transfer" },
      cantFind: { label: "I can't find my locker number", sub: "Get help locating it" },
      other: { label: "Something else", sub: "Ask assistant or contact support" },
      ticket: { label: "Check ticket status", sub: "View replies from admin" },
    },
    ticket: {
      intro: "Enter your ticket number and badge number to view updates or reply.",
      ticketNumber: "Ticket number",
      badge: "Badge number",
      ticketPlaceholder: "e.g. 00042",
      submit: "View my ticket",
    },
    transferPanel: {
      intro: "Locker transfers must be approved by the admin office. Please submit your details below and we'll process it within 1 business day.",
      submitLabel: "Submit transfer request",
      messageLabel: "Reason for transfer",
      messagePlaceholder: "e.g. moved to a different work location, current locker too far…",
    },
    cantFindPanel: {
      tryFirst: "Try these first:",
      tip1: "Check your intake confirmation email or paper slip.",
      tip2: "Ask your supervisor or HR — they usually have the assignment list.",
      tip3: "Use the lookup form above.",
      contactCta: "Still can't find it — contact us",
      formIntro: "We'll help you locate your locker. Please share your details so we can get back to you.",
      messageLabel: "Extra details (optional)",
      messagePlaceholder: "Anything that would help us find your assignment…",
      submitLabel: "Send to support",
      defaultMessage: "I can't find my locker number.",
    },
    otherPanel: {
      intro: "Ask our automated assistant, or send your question straight to a human below.",
      orHuman: "Prefer to talk to our team directly?",
      messageLabel: "How can we help?",
      messagePlaceholder: "Type your question or request…",
      submitLabel: "Talk to a human",
    },
    form: {
      fullName: "Full name",
      badge: "Badge number",
      contact: "Contact number",
      contactPlaceholder: "e.g. 012-3456789",
      lockerOptional: "Current locker number (optional)",
      errName: "Please enter your full name.",
      errBadge: "Please enter your badge number.",
      errContact: "Please enter a contact number.",
      errMessage: "Please describe your request.",
      errLocker: "Locker number is too long.",
      errTooMany: "Too many requests. Please try again in a few minutes.",
      errGeneric: "Couldn't submit right now — please try again or contact the admin office.",
      errOpenTicket: (ref, status) =>
        `You already have an open request (Ref #${ref}, status: ${status}). Please wait for our team to resolve it before submitting a new one. You can check its status using your reference number.`,
      errOpenTicketCta: "Check my ticket status",
      statusNew: "New",
      statusInProgress: "In progress",
      okHeading: "Your request has been received.",
      okTicket: "Ticket number:",
      okSaveNumber: "Save this number. Our team will contact you at",
      okCheckStatus: "Check ticket status",
      copyReference: "Copy reference number",
      copiedReference: "Copied!",
      submitting: "Submitting…",
    },
    faq: {
      ask: "Ask the assistant",
      placeholder: "e.g. How do I request a transfer?",
      thinking: "Assistant is typing",
      notHelpful: "Not helpful? Talk to a human",
      sendHuman: "Send to support",
      cancel: "Cancel",
      escalateHeading: "Send this to a human",
      yourQuestion: "Your question",
      moreDetail: "Add more detail if needed…",
      unavailable: "The assistant is unavailable right now.",
      disclaimer: "This is an automated assistant and cannot access your personal locker details.",
      you: "You",
      assistant: "Assistant",
    },
  },
  bm: {
    pageTitle: "Pertanyaan Loker",
    pageSubtitle: "Masukkan maklumat anda untuk cari loker yang ditetapkan.",
    languageLabel: "Bahasa",
    officeHours: {
      heading: "Waktu pejabat pentadbir",
      hours: "Isnin – Jumaat, 8:00 pagi – 5:15 petang",
      outside: "Permintaan di luar waktu pejabat akan diuruskan pada hari bekerja berikutnya.",
    },
    lookup: {
      cardTitle: "Carian loker",
      lockerNumber: "Nombor loker (pilihan)",
      lockerNumberHint: "Jika anda tahu, cth. A-023",
      badge: "Nombor badge",
      nidLast4: "4 digit akhir No. Kad Pengenalan (pilihan)",
      nidLast4Hint: "Membantu kami padankan jika ada nama yang sama.",
      submit: "Cari loker saya",
      privacyNote: "Maklumat anda hanya digunakan untuk mencari loker yang ditetapkan.",
      resultTitle: "Loker anda",
      resultName: "Nama",
      resultBadge: "Badge",
      resultLocker: "Loker",
      requestTransfer: "Mohon tukar loker",
      noMatch: "Tiada rekod dijumpai. Sila semak maklumat atau hubungi pejabat pentadbir.",
      tooMany: "Terlalu banyak cubaan. Sila cuba semula beberapa minit lagi.",
      cantFindCta: "Tidak jumpa loker anda? Hubungi kami",
      multipleHeading: (n: number) => `Anda mempunyai ${n} loker yang ditugaskan:`,
    },
    helpMenu: {
      heading: "Bagaimana kami boleh bantu?",
      back: "Kembali ke menu",
      lockerInquiry: { label: "Pertanyaan Loker", sub: "Cari loker atau mohon pertukaran" },
      cantFind: { label: "Saya tidak jumpa nombor loker saya", sub: "Dapatkan bantuan mencari" },
      other: { label: "Perkara lain", sub: "Tanya pembantu atau hubungi sokongan" },
      ticket: { label: "Semak status tiket", sub: "Lihat maklum balas admin" },
    },
    ticket: {
      intro: "Masukkan nombor tiket dan nombor badge untuk lihat kemas kini atau balas.",
      ticketNumber: "Nombor tiket",
      badge: "Nombor badge",
      ticketPlaceholder: "cth. 00042",
      submit: "Lihat tiket saya",
    },
    transferPanel: {
      intro: "Pertukaran loker perlu diluluskan oleh pejabat pentadbir. Sila hantar maklumat di bawah dan kami akan uruskan dalam 1 hari bekerja.",
      submitLabel: "Hantar permohonan tukar",
      messageLabel: "Sebab pertukaran",
      messagePlaceholder: "cth. berpindah lokasi kerja, loker sekarang terlalu jauh…",
    },
    cantFindPanel: {
      tryFirst: "Cuba dahulu:",
      tip1: "Semak e-mel pengesahan atau slip kertas anda.",
      tip2: "Tanya penyelia atau HR — mereka biasanya ada senarai pemberian.",
      tip3: "Guna borang carian di atas.",
      contactCta: "Masih tidak jumpa — hubungi kami",
      formIntro: "Kami akan bantu cari loker anda. Sila kongsi maklumat supaya kami boleh hubungi anda.",
      messageLabel: "Maklumat tambahan (pilihan)",
      messagePlaceholder: "Apa-apa yang boleh bantu kami cari…",
      submitLabel: "Hantar kepada sokongan",
      defaultMessage: "Saya tidak jumpa nombor loker saya.",
    },
    otherPanel: {
      intro: "Tanya pembantu automatik kami, atau hantar soalan terus kepada staf di bawah.",
      orHuman: "Mahu bercakap dengan pasukan kami secara langsung?",
      messageLabel: "Bagaimana kami boleh bantu?",
      messagePlaceholder: "Taip soalan atau permintaan anda…",
      submitLabel: "Hubungi kami",
    },
    form: {
      fullName: "Nama penuh",
      badge: "Nombor badge",
      contact: "Nombor telefon",
      contactPlaceholder: "cth. 012-3456789",
      lockerOptional: "Nombor loker semasa (pilihan)",
      errName: "Sila masukkan nama penuh anda.",
      errBadge: "Sila masukkan nombor badge anda.",
      errContact: "Sila masukkan nombor telefon.",
      errMessage: "Sila terangkan permintaan anda.",
      errLocker: "Nombor loker terlalu panjang.",
      errTooMany: "Terlalu banyak permintaan. Sila cuba semula beberapa minit lagi.",
      errGeneric: "Tidak dapat hantar sekarang — sila cuba semula atau hubungi pejabat pentadbir.",
      errOpenTicket: (ref, status) =>
        `Anda sudah mempunyai permintaan yang belum selesai (Rujukan #${ref}, status: ${status}). Sila tunggu pasukan kami menyelesaikannya sebelum menghantar permintaan baharu. Anda boleh semak status menggunakan nombor rujukan anda.`,
      errOpenTicketCta: "Semak status tiket saya",
      statusNew: "Baharu",
      statusInProgress: "Dalam proses",
      okHeading: "Permintaan anda telah diterima.",
      okTicket: "Nombor tiket:",
      okSaveNumber: "Simpan nombor ini. Pasukan kami akan hubungi anda di",
      okCheckStatus: "Semak status tiket",
      copyReference: "Salin nombor rujukan",
      copiedReference: "Disalin!",
      submitting: "Menghantar…",
    },
    faq: {
      ask: "Tanya pembantu",
      placeholder: "cth. Bagaimana untuk memohon pertukaran?",
      thinking: "Pembantu sedang menaip",
      notHelpful: "Tidak membantu? Hubungi kami",
      sendHuman: "Hantar kepada sokongan",
      cancel: "Batal",
      escalateHeading: "Hantar ini kepada staf",
      yourQuestion: "Soalan anda",
      moreDetail: "Tambah butiran jika perlu…",
      unavailable: "Pembantu tidak tersedia sekarang.",
      disclaimer: "Ini adalah pembantu automatik dan tidak boleh capai rekod loker peribadi anda.",
      you: "Anda",
      assistant: "Pembantu",
    },
  },
};
