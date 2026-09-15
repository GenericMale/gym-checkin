import { PDF } from '@libpdf/core';

const WEEKDAY_CODES = {
  montag: 'Mo',
  dienstag: 'Di',
  mittwoch: 'Mi',
  donnerstag: 'Do',
  freitag: 'Fr',
  samstag: 'Sa',
  sonntag: 'So',
};

/**
 * Parses time strings like:
 * - "21.09.2026 15:30 - 16:15 Dienstag"
 * - "21.09.2026 15;15 - 16:00 Freitag" (fixes the typo in the legacy system)
 * - "21.09.2026 16:30 - 18:30 / 17:00 - 19:00 Dienstag" (multi-slot training)
 */
function parseCourseTime(rawTime) {
  const normalized = rawTime.replace(/(\d{1,2});(\d{2})/g, '$1:$2').trim();

  // Extract start date (DD.MM.YYYY)
  const dateMatch = normalized.match(/^(\d{2}\.\d{2}\.\d{4})/);

  // Extract weekday
  const weekdayMatch = normalized.match(
    /\b(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b/i
  );
  const weekdayName = weekdayMatch ? weekdayMatch[1] : null;

  // Extract time ranges (e.g. "15:30 - 16:15")
  const timeMatches = [...normalized.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)];
  const slots = timeMatches.map((m) => ({ from: m[1], to: m[2] }));
  const primarySlot = slots[0] || null;

  return {
    startDate: dateMatch ? dateMatch[1] : null,
    weekdayName,
    weekday: weekdayName ? WEEKDAY_CODES[weekdayName.toLowerCase()] || null : null,
    from: primarySlot ? primarySlot.from : null,
    to: primarySlot ? primarySlot.to : null,
    slots,
  };
}

/**
 * Extracts the participant name from a person block. A block starts with:
 * "Nachname, A 1234 Ort P: [Telefon], [Geburtstag]"
 * followed by "Vorname  Straße  [Notiz]".
 */
function parsePersonBlock(lines) {
  if (lines.length < 2) return null;

  const lastNameMatch = lines[0].match(/^(?<lastName>.+?)\s+[A-Z]\s+\d{4}\s+.+?\s+P:/);
  if (!lastNameMatch || !lastNameMatch.groups) return null;

  const lastName = lastNameMatch.groups.lastName.replace(/,\s*$/, '').trim();
  const firstName = (lines[1].split(/\s{2,}/)[0] || '').trim();

  if (!firstName && !lastName) return null;

  return { firstName, lastName };
}

async function extractLines(pdfBytes) {
  const pdf = await PDF.load(pdfBytes);

  const lines = [];
  for (let i = 0; i < pdf.getPageCount(); i++) {
    const page = pdf.getPage(i);
    if (!page) continue;
    for (const line of page.extractText().lines) {
      if (line.text && line.text.trim().length > 0) {
        lines.push(line.text.trimEnd());
      }
    }
  }

  return lines;
}

/**
 * Parses a participants PDF exported by the club administration program.
 * Returns one entry per course with the data needed to sync it into the
 * turnplan, including the list of participants (first and last name only).
 */
/**
 * Joins a parsed person into the full name stored in the participant list.
 */
export function participantFullName(person) {
  if (!person) return '';
  return [person.firstName, person.lastName]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Reads the participant list stored on a course. Supports the JSON array
 * format used by the app as well as a plain newline separated list.
 */
export function parseParticipantNames(value) {
  if (value === undefined || value === null || value === '') return [];

  const normalize = (names) => names.map((name) => String(name).trim()).filter(Boolean);

  if (Array.isArray(value)) return normalize(value);

  const raw = String(value).trim();
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalize(parsed);
    } catch {
      // fall through to the plain list format
    }
  }
  return normalize(raw.split(/\r?\n/));
}

/**
 * Converts textarea input (one full name per line) into a participant list.
 */
export function parseParticipantText(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Serializes a participant list for storage in the database.
 */
export function serializeParticipantNames(names) {
  return JSON.stringify(parseParticipantNames(names));
}

/**
 * Converts a participant list into textarea input (one full name per line).
 */
export function participantNamesToText(value) {
  return parseParticipantNames(value).join('\n');
}

export async function parseParticipants(pdfBytes) {
  const allLines = await extractLines(pdfBytes);

  // Group multi-page courses together (e.g. KJ08 on p. 9, 10, 11)
  const coursesMap = new Map();
  let currentCourse = null;
  let currentBlock = [];

  const flushBlock = () => {
    if (currentBlock.length > 0 && currentCourse) {
      const person = parsePersonBlock(currentBlock);
      if (person) currentCourse.participants.push(person);
    }
    currentBlock = [];
  };

  for (const line of allLines) {
    // Course header line 1: "KURS: <id> [<season>] <name> KURSART: <type> [<date>]"
    const courseMatch = line.match(
      /^KURS:\s*(\S+)\s+\[([^\]]+)\]\s+(.*?)\s+KURSART:\s*(.*?)(?:\s+\d{2}\.\d{2}\.\d{4}.*)?$/
    );
    if (courseMatch) {
      flushBlock();
      const courseId = courseMatch[1].trim();

      if (coursesMap.has(courseId)) {
        currentCourse = coursesMap.get(courseId);
      } else {
        currentCourse = {
          courseId,
          season: courseMatch[2].trim(),
          name: courseMatch[3].trim(),
          type: courseMatch[4].trim(),
          organizer: '',
          location: '',
          startDate: null,
          weekday: null,
          weekdayName: null,
          timeFrom: null,
          timeTo: null,
          slots: [],
          participants: [],
        };
        coursesMap.set(courseId, currentCourse);
      }
      continue;
    }

    // Course header line 2: "ORGANISATOR: <organizer> ZEIT: <time> ORT: <location> [Seite N]"
    const orgMatch = line.match(
      /^ORGANISATOR:\s*(.*?)\s+ZEIT:\s*(.*?)\s+ORT:\s*(.*?)(?:\s+Seite\s+\d+.*)?$/
    );
    if (orgMatch && currentCourse) {
      const parsedTime = parseCourseTime(orgMatch[2].trim());

      currentCourse.organizer = orgMatch[1].trim();
      currentCourse.location = orgMatch[3].trim();
      currentCourse.startDate = parsedTime.startDate;
      currentCourse.weekday = parsedTime.weekday;
      currentCourse.weekdayName = parsedTime.weekdayName;
      currentCourse.timeFrom = parsedTime.from;
      currentCourse.timeTo = parsedTime.to;
      currentCourse.slots = parsedTime.slots;
      continue;
    }

    // Skip table header and page footers
    if (line.includes('Name, lfd. Nr, M-ID') || line.startsWith('V8.net')) {
      flushBlock();
      continue;
    }

    // Person start line
    const isPersonStart = /^[^\s].*?\s+[A-Z]\s+\d{4}\s+.*?\s+P:/.test(line);

    if (isPersonStart) {
      flushBlock();
      currentBlock.push(line);
    } else if (currentBlock.length > 0) {
      currentBlock.push(line);
    }
  }

  flushBlock();

  return Array.from(coursesMap.values());
}
