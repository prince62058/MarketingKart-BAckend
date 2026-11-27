// Last-resort error handler: client errors keep their message, anything else is reported as a
// generic failure so internal details (paths, queries, stack traces) never reach the caller.
const errorMiddleware = (err, req, res, next) => {
  const status = Number(err?.status || err?.statusCode) || (err?.name === "MulterError" ? 400 : 500);
  if (status >= 500) console.error("Error detected:", err?.stack || err);
  if (res.headersSent) return next(err);
  const message = status < 500 ? (err?.message || "Request failed") : "Something went wrong. Please try again.";
  return res.status(status).json({ success: false, message });
};

module.exports = errorMiddleware;
