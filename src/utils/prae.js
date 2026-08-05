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

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return dateStr;
};

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
    birthDate: formatDate(trainer.birth_date),
    address: trainer.address || '',
    iban: trainer.iban || '',
    generationDate: generationDate,
    month: month,
    year: year,
  };

  // Initialisiere Tage 1-31 mit 0
  for (let i = 1; i <= 31; i++) {
    data[`day${i}`] = 0;
  }

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
      data[`day${day}`] += pay;
    }
  });

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
    const buffer = await generatePraeDocument(data);
    zip.file(`PRAE_${trainerName.replace(/\s+/g, '_')}_${selectedMonth}.xlsx`, buffer);
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  return {
    buffer: zipBuffer,
    filename: `PRAE_Export_${selectedMonth}.zip`,
    contentType: 'application/zip',
  };
};
