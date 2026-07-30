const errorMiddleware = (err, req, res, next) => {
  console.error("Error detected:", err.stack || err);
  res.status(500).json({ message: err.message });
};

module.exports = errorMiddleware;
