const { appendFileSync } = require('node:fs');
const { EOL } = require('node:os');

function fileCommand(file, name, value) {
  if (!file) {
    return;
  }
  appendFileSync(file, `${name}=${value}${EOL}`);
}

function createCore(env = process.env) {
  return {
    getInput(name) {
      const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
      return env[key] || '';
    },
    getState(name) {
      return env[`STATE_${name}`] || '';
    },
    saveState(name, value) {
      fileCommand(env.GITHUB_STATE, name, value);
    },
    setSecret(value) {
      process.stdout.write(`::add-mask::${value}${EOL}`);
    },
    info(message) {
      process.stdout.write(`${message}${EOL}`);
    },
    setFailed(error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`::error::${message}${EOL}`);
      process.exitCode = 1;
    },
  };
}

module.exports = {
  createCore,
};
