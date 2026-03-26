import express from 'express';
import * as adminController from '../controllers/adminController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Auth
router.get('/admin/login', adminController.getLogin);
router.post('/admin/login', adminController.postLogin);
router.get('/admin/logout', adminController.logout);

// Dashboard & Protocol
router.get('/admin', requireAuth, adminController.getDashboard);
router.get('/admin/protocol', requireAuth, adminController.getProtocol);

// Actions
router.post('/admin/update-settings', requireAuth, adminController.updateSettings);
router.post('/admin/add-hall', requireAuth, adminController.addHall);
router.post('/admin/delete-hall/:id', requireAuth, adminController.deleteHall);
router.post('/admin/add-trainer', requireAuth, adminController.addTrainer);
router.post('/admin/edit-trainer/:id', requireAuth, adminController.editTrainer);
router.post('/admin/delete-trainer/:id', requireAuth, adminController.deleteTrainer);
router.post('/admin/delete-checkin/:id', requireAuth, adminController.deleteCheckin);
router.post('/admin/delete-filtered-checkins', requireAuth, adminController.deleteFilteredCheckins);

// Export
router.get('/admin/export', requireAuth, adminController.exportAll);
router.post('/api/export-trainer', adminController.exportTrainer);

export default router;
