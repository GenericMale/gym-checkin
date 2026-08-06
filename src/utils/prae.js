import carbone from 'carbone';
import JSZip from 'jszip';
import path from 'path';
import { promisify } from 'util';
import { getZonedNow, formatUtcTimestampInAppZone } from './time.js';

const render = promisify(carbone.render);

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'resources',
  'Pauschale_Reiseaufwandsentschaedigung.xlsx'
);

/**
 * Converts a currency string/number into spelled-out German words.
 */
function euroToWords(amount) {
  const ones = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
  const teens = [
    'zehn',
    'elf',
    'zwölf',
    'dreizehn',
    'vierzehn',
    'fünfzehn',
    'sechzehn',
    'siebzehn',
    'achtzehn',
    'neunzehn',
  ];
  const tens = [
    '',
    '',
    'zwanzig',
    'dreißig',
    'vierzig',
    'fünfzig',
    'sechzig',
    'siebzig',
    'achtzig',
    'neunzig',
  ];

  function under100(num) {
    if (num < 10) return ones[num];
    if (num < 20) return teens[num - 10];
    return num % 10 === 0
      ? tens[Math.floor(num / 10)]
      : `${ones[num % 10]}und${tens[Math.floor(num / 10)]}`;
  }

  function numToWord(n) {
    if (n === 0) return 'null';
    if (n < 100) return under100(n);

    const hundred = Math.floor(n / 100);
    const rem = n % 100;
    const prefix = hundred === 1 ? 'einhundert' : `${ones[hundred]}hundert`;

    return rem === 0 ? prefix : `${prefix}${under100(rem)}`;
  }

  const totalCents = Math.round(amount * 100);
  const euros = Math.floor(totalCents / 100);
  const cents = totalCents % 100;

  const euroPart = `${numToWord(euros)} Euro`;
  return cents > 0 ? `${euroPart} ${numToWord(cents)} Cent` : euroPart;
}

/**
 * Converts an ISO birth date (YYYY-MM-DD) into DDMMYY (e.g. 1990-05-03 -> 030590).
 */
function formatBirthDate(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(value);
  return `${m[3]}${m[2]}${m[1].slice(2)}`;
}

/**
 * Generiert die PRAE-Daten für einen Trainer für einen bestimmten Monat.
 */
export const preparePraeData = (trainer, rows, selectedMonth) => {
  const [year, month] = selectedMonth.split('-');

  const { year: gy, month: gm, day: gd } = getZonedNow();
  const generationDate = `${String(gd).padStart(2, '0')}.${String(gm).padStart(2, '0')}.${gy}`;

  const data = {
    trainerName: trainer.name,
    svn: trainer.svn || '',
    birthDate: formatBirthDate(trainer.birth_date),
    address: trainer.address || '',
    iban: trainer.iban || '',
    generationDate: generationDate,
    month: month,
    year: year,
    total: 0,
  };

  // Gruppiere nach Tag und summiere die Vergütung
  rows.forEach((row) => {
    let day = 0;
    if (row.date) {
      const parts = row.date.split('-');
      day = parseInt(parts[2], 10);
    } else if (row.start_timestamp) {
      const parts = formatUtcTimestampInAppZone(row.start_timestamp).split('-');
      day = parseInt(parts[2], 10);
    }

    if (day >= 1 && day <= 31) {
      const pay = typeof row.pay === 'number' ? row.pay : 0;
      data[`day${day}`] = (data[`day${day}`] || 0) + pay;
      data.total += pay;
    }
  });

  for (let day = 1; day <= 31; day++) {
    data[`day${day}`] = data[`day${day}`] || '';
  }

  data.totalWords = euroToWords(data.total);

  return data;
};

/**
 * Generiert ein einzelnes PRAE-Dokument als Buffer.
 */
export const generatePraeDocument = async (data) => {
  return await render(TEMPLATE_PATH, data);
};

/**
 * Generiert PRAE-Dokumente für alle Trainer und bündelt sie ggf. in einem ZIP.
 * @returns {Object} { buffer, filename, contentType }
 */
export const generateExport = async (rowsByTrainer, selectedMonth) => {
  const trainerNames = Object.keys(rowsByTrainer);

  if (trainerNames.length === 0) {
    throw new Error('No trainers data to export');
  }

  if (trainerNames.length === 1) {
    const trainerName = trainerNames[0];
    const { trainer, rows } = rowsByTrainer[trainerName];
    const data = preparePraeData(trainer, rows, selectedMonth);
    const buffer = await generatePraeDocument(data);
    const filename = `PRAE_${trainerName.replace(/\s+/g, '_')}_${selectedMonth}.xlsx`;
    return {
      buffer,
      filename,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  const zip = new JSZip();
  for (const trainerName of trainerNames) {
    const { trainer, rows } = rowsByTrainer[trainerName];
    const data = preparePraeData(trainer, rows, selectedMonth);

    if (data.total > 0) {
      const buffer = await generatePraeDocument(data);
      zip.file(`PRAE_${trainerName.replace(/\s+/g, '_')}_${selectedMonth}.xlsx`, buffer);
    }
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  return {
    buffer: zipBuffer,
    filename: `PRAE_Export_${selectedMonth}.zip`,
    contentType: 'application/zip',
  };
};
