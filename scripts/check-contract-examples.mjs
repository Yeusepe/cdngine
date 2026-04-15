import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const examplesRoot = join(process.cwd(), 'contracts', 'examples');
const ajv = new Ajv2020({
  allErrors: true,
  strict: false
});

function walk(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return walk(fullPath);
    }

    return fullPath.endsWith('.example.json') ? [fullPath] : [];
  });
}

const examplePaths = walk(examplesRoot);
const failures = [];

for (const examplePath of examplePaths) {
  const schemaPath = examplePath.replace(/\.example\.json$/, '.schema.json');

  try {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const example = JSON.parse(readFileSync(examplePath, 'utf8'));
    const validate = ajv.compile(schema);
    const valid = validate(example);

    if (!valid) {
      failures.push(
        `${examplePath}: ${ajv.errorsText(validate.errors, {
          separator: '; '
        })}`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${examplePath}: ${message}`);
  }
}

if (failures.length > 0) {
  console.error('Contract example validation failed:');

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  process.exit(1);
}

console.log(`Validated ${examplePaths.length} contract example file(s).`);
