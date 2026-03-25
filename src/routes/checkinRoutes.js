import express from 'express';
import { getCheckinPage, postCheckin, getSessionStatus } from '../controllers/checkinController.js';

const router = express.Router();

router.get('/checkin', getCheckinPage);
router.post('/api/checkin', postCheckin);
router.get('/api/session-status/:trainerId', getSessionStatus);

export default router;
