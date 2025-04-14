import type { AudioOriginalLangAllowed } from '../types/index';

export const audioExtensions = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a', '.wma'];

export const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v'];

export const allowedExtensions = [...audioExtensions, ...videoExtensions];

type LanguageObject = {
  [K in AudioOriginalLangAllowed]?: string;
};

export const languageCodes: LanguageObject = {
  af: 'Afrikaans',
  sq: 'Albanian',
  am: 'Amharic',
  ar: 'Arabic',
  hy: 'Armenian',
  as: 'Assamese',
  ast: 'Asturian',
  az: 'Azerbaijani',
  ba: 'Bashkir',
  eu: 'Basque',
  be: 'Belarusian',
  bn: 'Bengali',
  bs: 'Bosnian',
  br: 'Breton',
  bg: 'Bulgarian',
  my: 'Burmese',
  ca: 'Catalan',
  ceb: 'Cebuano',
  zh: 'Mandarin',
  hr: 'Croatian',
  cs: 'Czech',
  da: 'Danish',
  nl: 'Dutch',
  en: 'English',
  at: 'estonian',
  et: 'estonian',
  fo: 'Faroese',
  fi: 'Finnish',
  fr: 'French',
  fy: 'Western Frisian',
  ff: 'Fulah',
  gd: 'Gaelic',
  gl: 'Galician',
  lg: 'Ganda',
  ka: 'Georgian',
  de: 'German',
  el: 'Greek',
  gu: 'Gujarati',
  ht: 'Haitian Creole',
  ha: 'Hausa',
  haw: 'Hawaiian',
  he: 'Hebrew',
  hi: 'Hindi',
  hu: 'Hungarian',
  is: 'Icelandic',
  ig: 'Igbo',
  ilo: 'Iloko',
  id: 'Indonesian',
  ga: 'Irish',
  it: 'Italian',
  ja: 'Japanese',
  jv: 'Javanese',
  kn: 'Kannada',
  kk: 'Kazakh',
  km: 'Khmer',
  ko: 'Korean',
  lo: 'Lao',
  la: 'Latin',
  lv: 'Latvian',
  lb: 'Luxembourgish',
  ln: 'Lingala',
  lt: 'Lithuanian',
  mk: 'Macedonian',
  mg: 'Malagasy',
  ms: 'Malay',
  ml: 'Malayalam',
  mt: 'Maltese',
  mi: 'Maori',
  mr: 'Marathi',
  mo: 'Moldovan',
  mn: 'Mongolian',
  ne: 'Nepali',
  no: 'Norwegian',
  nn: 'Nynorsk',
  oc: 'Occitan',
  or: 'Oriya',
  pa: 'Punjabi',
  ps: 'Pashto',
  fa: 'Persian',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sa: 'Sanskrit',
  sr: 'Serbian',
  sn: 'Shona',
  sd: 'Sindhi',
  si: 'Sinhala',
  sk: 'Slovak',
  sl: 'Slovenian',
  so: 'Somali',
  es: 'Spanish',
  su: 'Sundanese',
  sw: 'Swahili',
  ss: 'Swati',
  sv: 'Swedish',
  tl: 'Tagalog',
  tg: 'Tajik',
  ta: 'Tamil',
  tt: 'Tatar',
  te: 'Telugu',
  th: 'Thai',
  bo: 'Tibetan',
  tn: 'Tswana',
  tr: 'Turkish',
  tk: 'Turkmen',
  uk: 'Ukrainian',
  ur: 'Urdu',
  uz: 'Uzbek',
  vi: 'Vietnamese',
  cy: 'Welsh',
  wo: 'Wolof',
  xh: 'Xhosa',
  yi: 'Yiddish',
  yo: 'Yoruba',
  zu: 'Zulu',
};

export const nonLatinScriptLanguages: string[] = [
  'ar', // Arabic
  'am', // Amharic
  'as', // Assamese
  'bn', // Bengali
  'my', // Burmese
  'zh', // Mandarin
  'gu', // Gujarati
  'he', // Hebrew
  'hi', // Hindi
  'ja', // Japanese
  'kn', // Kannada
  'kk', // Kazakh
  'km', // Khmer
  'ko', // Korean
  'lo', // Lao
  'ml', // Malayalam
  'mr', // Marathi
  'mn', // Mongolian
  'ne', // Nepali
  'or', // Oriya
  'pa', // Punjabi
  'ps', // Pashto
  'fa', // Persian
  'sa', // Sanskrit
  'sd', // Sindhi
  'si', // Sinhala
  'ta', // Tamil
  'te', // Telugu
  'th', // Thai
  'bo', // Tibetan
  'ur', // Urdu
  'yi', // Yiddish
];
