import * as reportService from '../services/reportService.js';
import { sendReport } from './adminController.js';
import { asyncHandler, ok } from '../utils/http.js';

const v = (req) => req.validated;

export const types = (_req, res) => ok(res, reportService.REPORT_TYPES);
export const osusu = asyncHandler(async (req, res) => sendReport(res, await reportService.osusuReport(req.user, v(req).params.groupId, v(req).query, req)));
export const collector = asyncHandler(async (req, res) => sendReport(res, await reportService.collectorReport(req.user, v(req).query, req)));
export const platform = asyncHandler(async (req, res) => sendReport(res, await reportService.platformReport(req.user, v(req).query, req)));
