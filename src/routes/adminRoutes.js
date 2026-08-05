import express from 'express';
import * as adminController from '../controllers/adminController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Auth
router.get('/admin/login', adminController.getLogin);
router.post('/admin/login', adminController.postLogin);
router.get('/admin/logout', adminController.logout);

// Dashboard Tabs
router.get('/admin', requireAuth, (req, res) => res.redirect(`${process.env.BASE_PATH || ''}/admin/turnplan`));
router.get('/admin/turnplan', requireAuth, adminController.getTurnplan);
router.get('/admin/trainers', requireAuth, adminController.getTrainers);
router.get('/admin/halls', requireAuth, adminController.getHalls);
router.get('/admin/protocol', requireAuth, adminController.getProtocol);

// Settings & Halls
router.post('/admin/update-settings', requireAuth, adminController.updateSettings);
router.post('/admin/add-hall', requireAuth, adminController.addHall);
router.post('/admin/edit-hall/:id', requireAuth, adminController.editHall);
router.post('/admin/delete-hall/:id', requireAuth, adminController.deleteHall);

// Trainers
router.post('/admin/add-trainer', requireAuth, adminController.addTrainer);
router.post('/admin/edit-trainer/:id', requireAuth, adminController.editTrainer);
router.post('/admin/delete-trainer/:id', requireAuth, adminController.deleteTrainer);

// Turnplan
router.post('/admin/add-turnplan', requireAuth, adminController.addTurnplan);
router.post('/admin/edit-turnplan/:id', requireAuth, adminController.editTurnplan);
router.post('/admin/delete-turnplan/:id', requireAuth, adminController.deleteTurnplan);

// Checkins / Protocol
router.post('/admin/delete-checkin/:id', requireAuth, adminController.deleteCheckin);
router.post('/admin/delete-filtered-checkins', requireAuth, adminController.deleteFilteredCheckins);
router.post('/admin/add-checkin', requireAuth, adminController.addCheckin);
router.post('/admin/edit-checkin/:id', requireAuth, adminController.editCheckin);

// Export
router.get('/admin/export', requireAuth, adminController.exportAll);
router.post('/api/export-trainer', adminController.exportTrainer);

export default router;
