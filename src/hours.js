// Opening hours: one TOML file, parsed and validated here, rendered by <OpeningHours>.
import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const SCHEMA_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {[string, string][]} Intervals
 * @typedef {{ date: string, to?: string, closed: boolean, hours: Intervals, note: Record<string, string> }} HoursException
 * @typedef {{ week: Record<string, Intervals>, exceptions: HoursException[] }} Hours
 */

/**
 * Parse and validate hours.toml. Returns { hours, errors }; hours is null when errors exist.
 * @param {string} file absolute path
 * @param {string[]} languages site languages; every note needs all of them
 */
export function loadHours(file, languages) {
  /** @type {string[]} */
  const errors = [];
  let raw;
  try {
    raw = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { hours: null, errors: [`cannot read ${file}: ${error.message}`] };
  }

  const checkIntervals = (value, where) => {
    if (!Array.isArray(value)) {
      errors.push(`${where}: expected a list of ["HH:MM", "HH:MM"] pairs, or [] for closed`);
      return [];
    }
    const intervals = [];
    for (const pair of value) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((t) => typeof t === 'string' && TIME.test(t))) {
        errors.push(`${where}: ${JSON.stringify(pair)} is not a ["HH:MM", "HH:MM"] pair`);
        continue;
      }
      if (pair[0] >= pair[1]) errors.push(`${where}: ${pair[0]} is not before ${pair[1]}`);
      intervals.push(/** @type {[string, string]} */ (pair));
    }
    const sorted = [...intervals].sort((a, b) => a[0].localeCompare(b[0]));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i][0] < sorted[i - 1][1]) errors.push(`${where}: intervals overlap`);
    }
    return sorted;
  };

  const week = /** @type {Record<string, Intervals>} */ ({});
  const rawWeek = raw.week ?? {};
  for (const key of Object.keys(rawWeek)) {
    if (!DAYS.includes(key)) errors.push(`[week]: unknown day "${key}" (use ${DAYS.join(', ')})`);
  }
  for (const day of DAYS) {
    if (!(day in rawWeek)) errors.push(`[week]: missing "${day}" (use ${day} = [] when closed)`);
    week[day] = checkIntervals(rawWeek[day] ?? [], `[week].${day}`);
  }

  const exceptions = [];
  for (const [index, entry] of (raw.exception ?? []).entries()) {
    const where = `[[exception]] #${index + 1}`;
    if (typeof entry.date !== 'string' || !DATE.test(entry.date) || Number.isNaN(Date.parse(entry.date))) {
      errors.push(`${where}: date must be YYYY-MM-DD`);
      continue;
    }
    if (entry.to !== undefined && (typeof entry.to !== 'string' || !DATE.test(entry.to) || entry.to < entry.date)) {
      errors.push(`${where}: to must be YYYY-MM-DD and not before date`);
    }
    const closed = entry.closed === true;
    if (closed && entry.hours !== undefined) errors.push(`${where}: use either closed = true or hours, not both`);
    if (!closed && entry.hours === undefined) errors.push(`${where}: needs closed = true or hours = [...]`);
    const note = entry.note ?? {};
    if (typeof note !== 'object' || Array.isArray(note)) errors.push(`${where}: note must be a table like { nl = "..." }`);
    else if (Object.keys(note).length) {
      for (const language of languages) {
        if (typeof note[language] !== 'string' || !note[language].trim()) errors.push(`${where}: note is missing "${language}"`);
      }
    }
    exceptions.push({
      date: entry.date,
      to: entry.to,
      closed,
      hours: closed ? [] : checkIntervals(entry.hours ?? [], `${where}.hours`),
      note,
    });
  }
  exceptions.sort((a, b) => a.date.localeCompare(b.date));

  return { hours: errors.length ? null : { week, exceptions }, errors };
}

/** schema.org openingHoursSpecification + specialOpeningHoursSpecification. @param {Hours} hours */
export function hoursJsonLd(hours) {
  const regular = [];
  DAYS.forEach((day, index) => {
    for (const [opens, closes] of hours.week[day]) {
      regular.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: SCHEMA_DAYS[index], opens, closes });
    }
  });
  const special = [];
  for (const exception of hours.exceptions) {
    const base = { '@type': 'OpeningHoursSpecification', validFrom: exception.date, validThrough: exception.to ?? exception.date };
    // schema.org convention: closed all day = opens and closes at 00:00.
    if (exception.closed) special.push({ ...base, opens: '00:00', closes: '00:00' });
    else for (const [opens, closes] of exception.hours) special.push({ ...base, opens, closes });
  }
  return { openingHoursSpecification: regular, ...(special.length ? { specialOpeningHoursSpecification: special } : {}) };
}

/** Localised weekday names, Monday first, from Intl (no copy to translate). @param {string} lang */
export function weekdayNames(lang) {
  const format = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' });
  // 2024-01-01 is a Monday.
  return DAYS.map((_, index) => format.format(new Date(Date.UTC(2024, 0, 1 + index))));
}

/** @param {string} date YYYY-MM-DD @param {string} lang */
export function formatDate(date, lang) {
  return new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
