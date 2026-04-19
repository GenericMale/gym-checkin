import dotenv from 'dotenv';
dotenv.config();

export const branding = {
  name: process.env.APP_NAME || 'Gym Check-In',
  shortName: process.env.APP_SHORT_NAME || 'Gym',
  accentText: process.env.APP_ACCENT_TEXT || '',
  description: process.env.APP_DESCRIPTION || 'Simple Check-In for your Club',
  colors: {
    primary: process.env.APP_COLOR_PRIMARY || '#76a59d',
    primaryHover: process.env.APP_COLOR_PRIMARY_HOVER || '#65918a',
  },
};

export default {
  branding,
};
