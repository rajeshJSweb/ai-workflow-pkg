const isNonZeroBuffer = (buffer) => {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] !== 0) return true;
  }
  return false;
};

module.exports = { isNonZeroBuffer };
