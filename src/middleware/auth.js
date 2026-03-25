export const requireAuth = (req, res, next) => {
  if (req.session.loggedIn) return next();

  const BASE_PATH = process.env.BASE_PATH || '';
  res.redirect(`${BASE_PATH}/admin/login`);
};
