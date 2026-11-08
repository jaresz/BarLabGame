import { readFileSync } from 'node:fs';

const configPath = process.argv[2];
if (!configPath) {
  throw new Error('Deployment configuration path is required.');
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const names = ['DeployDestination', 'DeployRemoteHost', 'DeployRemoteAssets'];
const values = names.map(name => {
  const value = config[name];
  // The Bash caller reads one setting per line, so embedded line breaks cannot be represented.
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value) || /<[^>]+>/.test(value)) {
    throw new Error(`${name} must be a nonempty value without placeholders or line breaks.`);
  }
  return value;
});

if (!/\/assets\/?$/.test(config.DeployRemoteAssets) || config.DeployRemoteAssets.includes("'")) {
  throw new Error('DeployRemoteAssets must end with /assets and cannot contain a single quote.');
}
if (!Number.isInteger(config.DeploySshPort) || config.DeploySshPort < 1 || config.DeploySshPort > 65535) {
  throw new Error('DeploySshPort must be an integer from 1 to 65535.');
}

process.stdout.write([...values, String(config.DeploySshPort)].join('\n') + '\n');
