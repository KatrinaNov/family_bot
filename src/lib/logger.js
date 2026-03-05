/**
 * Простой логгер с уровнем и префиксом.
 * В production можно заменить на winston/pino.
 */
const PREFIX = "[FamilyBot]";

function log(level, ...args) {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${PREFIX} [${level}]`, ...args);
}

module.exports = {
  info: (...args) => log("INFO", ...args),
  warn: (...args) => log("WARN", ...args),
  error: (...args) => log("ERROR", ...args),
  debug: (...args) => (process.env.DEBUG ? log("DEBUG", ...args) : null),
};
