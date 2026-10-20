import { readFile } from 'node:fs/promises';
import { prisma } from '../config/database.js';
import { evidenceAbsolutePath } from '../services/evidence.service.js';

export async function streamEvidence(req, res, next) {
  try {
    const transaction = await prisma.transaction.findFirst({
      where: { id: req.params.transactionId, vendorId: req.auth.vendorId },
      select: { evidencePath: true, evidenceMimeType: true },
    });
    if (!transaction?.evidencePath) {
      const error = new Error('Evidence was not found for this transaction.');
      error.status = 404;
      error.code = 'EVIDENCE_NOT_FOUND';
      throw error;
    }
    const filePath = evidenceAbsolutePath(transaction.evidencePath);
    if (!filePath) {
      const error = new Error('Evidence file path is invalid.');
      error.status = 500;
      throw error;
    }
    const data = await readFile(filePath);
    res.set({
      'Content-Type': transaction.evidenceMimeType,
      'Content-Length': data.length,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      error.status = 404;
      error.code = 'EVIDENCE_NOT_FOUND';
      error.message = 'Evidence file was not found.';
    }
    return next(error);
  }
}
