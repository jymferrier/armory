const express = require('express');
const router = express.Router();
const { firearmsQueries, opticsQueries, magsQueries } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.redirect('/inventory');

  const isSpouseView = !!req.session.user.is_spouse_view;

  let firearms = firearmsQueries.search(q);
  if (isSpouseView) firearms = firearms.filter(f => f.spouse_visible);

  const optics = opticsQueries.search(q);
  const mags = magsQueries.search(q);

  const total = firearms.length + optics.length + mags.length;

  res.render('search', { user: req.session.user, q, firearms, optics, mags, total });
});

module.exports = router;
