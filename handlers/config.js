const fs = require('fs');
const toml = require('@iarna/toml');

/**
 * Loads and parses a TOML file and returns it as a JSON object.
 *
 * @param {string} filePath - The path to the TOML file.
 * @returns {object} - The parsed TOML content as a JSON object.
 */
function loadConfig(filePath) {
  try {
    if (global.__settings) {
      return global.__settings;
    }

    const tomlString = fs.readFileSync(filePath, 'utf8');
    const config = toml.parse(tomlString);
    global.__settings = config;
    return config;
  } catch (err) {
    console.error('Error reading or parsing the TOML file:', err);
    throw err;
  }
}

module.exports = loadConfig;
