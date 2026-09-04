import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import JSZip from 'jszip';
import { getZonedNow, formatUtcTimestampInAppZone } from './time.js';

const UNPACKED_TEMPLATE_PATH = path.join(process.cwd(), 'resources', 'PRAE');

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
  const documentDate = `${String(gd).padStart(2, '0')}.${String(gm).padStart(2, '0')}.${gy}`;

  const data = {
    fullName: trainer.name || '',
    socialSecurityNumber: trainer.svn || '',
    dateOfBirth: formatBirthDate(trainer.birth_date),
    foreignSocialSecurityNumber: '',
    address: trainer.address || '',
    activity: 'Übungsleiter',

    month: month,
    year: year,
    purpose: '',
    totalAmount: 0,

    employmentStatus: 'secondary',
    allowanceType: 'single',

    payment: 'bank_transfer',
    cashReceivedDate: '',
    iban: trainer.iban || '',
    bic: '',

    organizationName: process.env.APP_NAME,
    confirmed: true,
    documentDate,
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
      data.totalAmount += pay;
    }
  });

  for (let day = 1; day <= 31; day++) {
    data[`day${day}`] = data[`day${day}`] || '';
  }

  data.amountInWords = euroToWords(data.totalAmount);

  return data;
};

/**
 * Generiert ein einzelnes PRAE-Dokument als Buffer via EJS & JSZip.
 */
export const generatePraeDocument = async (trainersDataInput) => {
  const zip = new JSZip();
  const trainers = Array.isArray(trainersDataInput) ? trainersDataInput : [trainersDataInput];

  function walkDirectory(currentDir) {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const relativePath = path.relative(UNPACKED_TEMPLATE_PATH, fullPath).replace(/\\/g, '/');

      if (fs.statSync(fullPath).isDirectory()) {
        walkDirectory(fullPath);
      } else if (/\.(xml|rels|vml)$/i.test(item)) {
        const rawTemplate = fs.readFileSync(fullPath, 'utf8');

        if (relativePath.startsWith('xl/worksheets/') || relativePath.startsWith('xl/drawings/')) {
          // per-sheet template
          trainers.forEach((trainer) => {
            const targetPath = relativePath.replace(/1(?=\.(xml|vml|xml\.rels)$)/i, trainer.index);
            const renderedXml = ejs.render(rawTemplate, trainer);
            zip.file(targetPath, renderedXml);
          });
        } else {
          const renderedXml = ejs.render(rawTemplate, { trainers });
          zip.file(relativePath, renderedXml);
        }
      } else {
        zip.file(relativePath, fs.readFileSync(fullPath));
      }
    }
  }
  walkDirectory(UNPACKED_TEMPLATE_PATH);

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
};

/**
 * Generiert PRAE-Dokumente für alle Trainer.
 * @returns {Object} { buffer, filename, contentType }
 */
export const generateExport = async (rowsByTrainer, selectedMonth) => {
  const trainerNames = Object.keys(rowsByTrainer);

  if (trainerNames.length === 0) {
    throw new Error('No trainers data to export');
  }

  // Build dataset for trainers with > 0 compensation
  const trainersDataList = [];
  for (const trainerName of trainerNames) {
    const { trainer, rows } = rowsByTrainer[trainerName];
    const data = preparePraeData(trainer, rows, selectedMonth);
    data.index = trainersDataList.length + 1;

    if (data.totalAmount > 0) {
      trainersDataList.push(data);
    }
  }

  if (trainersDataList.length === 0) {
    throw new Error('No payable data for selected month');
  }

  let filename;
  if (trainersDataList.length === 1) {
    const fullName = trainersDataList[0].fullName;
    filename = `PRAE_${selectedMonth}_${fullName}.xlsx`;
  } else {
    filename = `PRAE_${selectedMonth}.xlsx`;
  }

  return {
    buffer: await generatePraeDocument(trainersDataList),
    filename,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
};;
