/* eslint-disable no-loop-func */
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';

const currentDir = __dirname;

async function runTsFilesSequentially() {
  const files = fs.readdirSync(currentDir);
  const tsFiles = files.filter(
    (file) => path.extname(file) === '.ts' && path.basename(file) !== 'index.ts'
  );
  for (const file of tsFiles) {
    console.log(`Running: ${file}`);
    const env = { ...process.env, NODE_ENV: 'production' };
    await new Promise<void>((resolve, reject) => {
      const child = spawn(`ts-node`, [path.join(currentDir, file)], {
        stdio: 'inherit',
        env,
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`error code: ${code}`));
        }
      });
    });
  }
}

runTsFilesSequentially();
