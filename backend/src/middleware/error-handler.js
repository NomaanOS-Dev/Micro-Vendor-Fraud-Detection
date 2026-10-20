export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error.code === 'LIMIT_FILE_SIZE') {
    error.status = 413;
    error.message = 'Evidence images must be 5 MB or smaller.';
    error.code = 'EVIDENCE_TOO_LARGE';
  }

  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status
    : 500;

  if (status >= 500) {
    console.error('Unhandled request error', {
      method: req.method,
      path: req.path,
      message: error.message,
    });
  }

  res.status(status).json({
    error: {
      code: status >= 500 ? 'INTERNAL_ERROR' : (error.code ?? 'REQUEST_ERROR'),
      message: status >= 500 ? 'An unexpected error occurred.' : error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  });
}

