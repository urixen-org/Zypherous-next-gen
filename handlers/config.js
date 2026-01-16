const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Loads and parses a YAML file and returns it as a JSON object.
 *
 * @param {string} filePath - The path to the YAML file.
 * @returns {object} - The parsed YAML content as a JSON object.
 */
function loadConfig(filePath) {
  try {
    const resolvedPath = path.resolve(filePath);
    if (
      global.__settings &&
      global.__settingsPath &&
      global.__settingsPath === resolvedPath
    ) {
      return global.__settings;
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    const ext = path.extname(resolvedPath).toLowerCase();
    let config;
    if (ext === '.yaml' || ext === '.yml') {
      config = yaml.load(content);
    } else {
    throw new Error(`Unsupported config format: ${ext}`);
    }

    global.__settings = config;
    global.__settingsPath = resolvedPath;
    return config;
  } catch (err) {
    console.error('Error reading or parsing the YAML file:', err);
    throw err;
  }
}

module.exports = loadConfig;
