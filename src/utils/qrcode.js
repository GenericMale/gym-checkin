import QRCode from 'qrcode';
import logger from './logger.js';

export const generateQRCode = async (text) => {
  try {
    return await QRCode.toDataURL(text);
  } catch (err) {
    logger.error('Error generating QR code', err);
    throw err;
  }
};
