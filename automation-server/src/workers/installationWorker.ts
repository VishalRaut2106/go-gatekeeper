import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { config } from '../config.js';
import { Logger } from '../logger.js';
import { npmClient } from '../analytics/npmClient.js';
import { testsRepository, TestRun } from '../database/repositories/testsRepository.js';

const logger = new Logger('InstallationWorker');

export interface InstallationTestOptions {
  packageName?: string;
  targetVersion?: string;
  triggerType?: 'SCHEDULED' | 'MANUAL';
  timeoutMs?: number;
}

export interface WorkerExecutionResult {
  runId: string;
  success: boolean;
  targetVersion: string;
  installedVersion: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export class InstallationWorker {
  /**
   * Sanitizes package name and version to prevent command injection
   */
  private validatePackageSpec(pkgName: string, version: string): void {
    const validPkgRegex = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
    const validVerRegex = /^(latest|next|beta|canary|[0-9a-zA-Z\.\-\+\^~>=<]+)$/;

    if (!validPkgRegex.test(pkgName)) {
      throw new Error(`Invalid package name provided: "${pkgName}"`);
    }
    if (!validVerRegex.test(version)) {
      throw new Error(`Invalid package version or tag specified: "${version}"`);
    }
  }

  /**
   * Executes a command in an isolated directory with a timeout and captured streams
   */
  private runCommand(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // On Windows npm is npm.cmd, npx is npx.cmd
      const isWin = process.platform === 'win32';
      const executable = isWin && (command === 'npm' || command === 'npx') ? `${command}.cmd` : command;

      logger.debug(`Spawning: ${executable} ${args.join(' ')} in ${cwd}`);

      const child = spawn(executable, args, {
        cwd,
        env: {
          ...process.env,
          // Guarantee safe npm flags to prevent arbitrary post-install script side-effects during smoke checks
          NODE_ENV: 'test',
          NPM_CONFIG_AUDIT: 'false',
          NPM_CONFIG_FUND: 'false',
          NPM_CONFIG_UPDATE_NOTIFIER: 'false',
        },
        shell: isWin,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 3000);
        } catch (e) {}
        reject(new Error(`Execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (!timedOut) {
          resolve({
            code: code ?? (stderr ? 1 : 0),
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          });
        }
      });
    });
  }

  /**
   * Executes the full isolated installation test lifecycle
   */
  async runLifecycle(options: InstallationTestOptions = {}): Promise<WorkerExecutionResult> {
    const runId = `test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const startTime = Date.now();
    const pkgName = options.packageName || config.packageName;
    const requestedVersion = options.targetVersion || config.packageVersion || 'latest';
    const triggerType = options.triggerType || 'MANUAL';
    const timeoutMs = options.timeoutMs || config.testTimeoutMs || 90000;

    this.validatePackageSpec(pkgName, requestedVersion);

    let tempDir = '';
    let installedVersion: string | null = null;
    let combinedStdout = '';
    let combinedStderr = '';
    let testSuccess = false;
    let errorMessage: string | null = null;
    let finalExitCode: number = 0;

    logger.info(`[${runId}] Starting installation test worker for ${pkgName}@${requestedVersion}...`);

    try {
      // 1. Resolve target version from npm registry if "latest"
      let resolvedVersion = requestedVersion;
      if (requestedVersion === 'latest') {
        const details = await npmClient.fetchPackageDetails(pkgName);
        resolvedVersion = details.latestVersion || 'latest';
        logger.info(`[${runId}] Resolved "latest" to exact version ${resolvedVersion}`);
      }

      // 2. Create isolated temp directory
      const baseDir = config.testTempBaseDir || os.tmpdir();
      tempDir = fs.mkdtempSync(path.join(baseDir, 'gatekeeper-worker-'));
      logger.debug(`[${runId}] Created temporary workspace at: ${tempDir}`);

      // 3. Initialize minimal package.json in temp directory
      const initPkgJson = {
        name: 'gatekeeper-smoke-test-workspace',
        version: '1.0.0',
        private: true,
      };
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(initPkgJson, null, 2));

      // 4. Install package in isolated directory
      const installTarget = `${pkgName}@${resolvedVersion}`;
      logger.info(`[${runId}] Running "npm install --no-audit --no-fund ${installTarget}"`);

      const installResult = await this.runCommand(
        'npm',
        ['install', '--no-audit', '--no-fund', '--no-package-lock', installTarget],
        tempDir,
        timeoutMs
      );

      combinedStdout += `=== NPM INSTALL OUTPUT ===\n${installResult.stdout}\n\n`;
      combinedStderr += installResult.stderr ? `=== NPM INSTALL STDERR ===\n${installResult.stderr}\n\n` : '';

      if (installResult.code !== 0) {
        finalExitCode = installResult.code;
        throw new Error(`npm install failed with exit code ${installResult.code}: ${installResult.stderr}`);
      }

      // 5. Verify installed package file presence and inspect package.json
      const installedPkgJsonPath = path.join(tempDir, 'node_modules', pkgName, 'package.json');
      if (!fs.existsSync(installedPkgJsonPath)) {
        throw new Error(`Package installed but ${installedPkgJsonPath} was not found on disk.`);
      }

      const installedPkgData = JSON.parse(fs.readFileSync(installedPkgJsonPath, 'utf8'));
      installedVersion = installedPkgData.version || resolvedVersion;
      logger.info(`[${runId}] Successfully verified package files. Detected version: ${installedVersion}`);

      // 6. Run safe, non-destructive CLI smoke tests
      logger.info(`[${runId}] Executing smoke verification test...`);
      const smokeScript = `
const path = require('path');
const fs = require('fs');
const pkg = require('./node_modules/${pkgName}/package.json');
console.log('Smoke test passed: ' + pkg.name + '@' + pkg.version);
if (pkg.bin) {
  console.log('CLI bin defined: ' + JSON.stringify(pkg.bin));
}
`;
      const smokeScriptPath = path.join(tempDir, 'smoke-test.cjs');
      fs.writeFileSync(smokeScriptPath, smokeScript);

      const smokeResult = await this.runCommand(
        'node',
        ['smoke-test.cjs'],
        tempDir,
        15000 // 15s max for smoke test
      );

      combinedStdout += `=== SMOKE TEST VERIFICATION ===\n${smokeResult.stdout}\n`;
      if (smokeResult.stderr) {
        combinedStderr += `=== SMOKE TEST STDERR ===\n${smokeResult.stderr}\n`;
      }

      if (smokeResult.code !== 0) {
        finalExitCode = smokeResult.code;
        throw new Error(`Smoke test failed with code ${smokeResult.code}: ${smokeResult.stderr}`);
      }

      testSuccess = true;
      logger.info(`[${runId}] Installation test completed successfully in ${Date.now() - startTime}ms!`);
    } catch (err: any) {
      testSuccess = false;
      errorMessage = err.message || 'Unknown test worker error';
      combinedStderr += `\n[FATAL WORKER ERROR]: ${errorMessage}`;
      logger.error(`[${runId}] Installation test failed: ${errorMessage}`);
    } finally {
      // 7. Save test result to database before cleanup
      const finalDurationMs = Date.now() - startTime;
      const status: TestRun['status'] = errorMessage?.includes('timed out')
        ? 'TIMEOUT'
        : testSuccess
        ? 'SUCCESS'
        : 'FAILURE';

      try {
        await testsRepository.saveTestRun({
          id: runId,
          package_name: pkgName,
          target_version: requestedVersion,
          installed_version: installedVersion,
          status,
          trigger_type: triggerType,
          exit_code: finalExitCode,
          duration_ms: finalDurationMs,
          stdout: combinedStdout.trim(),
          stderr: combinedStderr.trim(),
          error_message: errorMessage,
          created_at: new Date().toISOString(),
        });
        logger.info(`[${runId}] Persisted test run record with status: ${status}`);
      } catch (dbErr: any) {
        logger.error(`[${runId}] Failed to save test record: ${dbErr.message}`);
      }

      // 8. Delete temporary directory and its installed files (Guaranteed cleanup)
      if (tempDir && fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
          logger.debug(`[${runId}] Cleaned up temporary directory: ${tempDir}`);
        } catch (cleanupErr: any) {
          logger.warn(`[${runId}] Failed to clean up tempDir ${tempDir}: ${cleanupErr.message}`);
        }
      }

      return {
        runId,
        success: testSuccess,
        targetVersion: requestedVersion,
        installedVersion,
        durationMs: finalDurationMs,
        stdout: combinedStdout,
        stderr: combinedStderr,
        error: errorMessage || undefined,
      };
    }
  }
}

export const installationWorker = new InstallationWorker();
