/**
 * Purpose: Provides a controlled process-execution boundary for storage adapters that consume upstream CLIs such as Kopia and ORAS.
 * Governing docs:
 * - docs/upstream-integration-model.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/storage-tiering-and-materialization.md
 * External references:
 * - https://kopia.io/docs/reference/command-line/common/snapshot-create/
 * - https://oras.land/docs/commands/oras_push/
 * Tests:
 * - packages/storage/test/cli-adapters.test.ts
 */

import { spawn } from 'node:child_process';

export interface CommandExecution {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  stdin?: string;
}

export interface CommandExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(execution: CommandExecution): Promise<CommandExecutionResult>;
}

export class CommandExecutionError extends Error {
  readonly execution: CommandExecution;
  readonly result: CommandExecutionResult;

  constructor(execution: CommandExecution, result: CommandExecutionResult) {
    super(
      `Command "${execution.command}" exited with code ${result.exitCode}: ${result.stderr || result.stdout || 'no output'}`
    );
    this.name = 'CommandExecutionError';
    this.execution = execution;
    this.result = result;
  }
}

export class CommandTimeoutError extends Error {
  readonly execution: CommandExecution;
  readonly timeoutMs: number;

  constructor(execution: CommandExecution, timeoutMs: number) {
    super(`Command "${execution.command}" exceeded timeout of ${timeoutMs}ms.`);
    this.name = 'CommandTimeoutError';
    this.execution = execution;
    this.timeoutMs = timeoutMs;
  }
}

export class ChildProcessCommandRunner implements CommandRunner {
  async run(execution: CommandExecution): Promise<CommandExecutionResult> {
    return new Promise<CommandExecutionResult>((resolve, reject) => {
      let settled = false;
      const child = spawn(execution.command, execution.args, {
        cwd: execution.cwd,
        env: { ...process.env, ...execution.env },
        stdio: 'pipe',
        shell: false
      });

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | undefined;

      const settleReject = (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        reject(error);
      };

      const settleResolve = (result: CommandExecutionResult) => {
        if (settled) {
          return;
        }

        settled = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        resolve(result);
      };

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });

      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (error) => {
        settleReject(error);
      });

      child.on('close', (exitCode) => {
        const result = {
          exitCode: exitCode ?? -1,
          stdout,
          stderr
        };

        if (result.exitCode !== 0) {
          settleReject(new CommandExecutionError(execution, result));
          return;
        }

        settleResolve(result);
      });

      if (typeof execution.stdin === 'string') {
        child.stdin.write(execution.stdin);
      }

      child.stdin.end();

      if (typeof execution.timeoutMs === 'number') {
        const timeoutMs = execution.timeoutMs;
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          settleReject(new CommandTimeoutError(execution, timeoutMs));
        }, timeoutMs);
      }
    });
  }
}
