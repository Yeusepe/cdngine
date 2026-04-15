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
  constructor(
    readonly execution: CommandExecution,
    readonly result: CommandExecutionResult
  ) {
    super(
      `Command "${execution.command}" exited with code ${result.exitCode}: ${result.stderr || result.stdout || 'no output'}`
    );
    this.name = 'CommandExecutionError';
  }
}

export class ChildProcessCommandRunner implements CommandRunner {
  async run(execution: CommandExecution): Promise<CommandExecutionResult> {
    return new Promise<CommandExecutionResult>((resolve, reject) => {
      const child = spawn(execution.command, execution.args, {
        cwd: execution.cwd,
        env: { ...process.env, ...execution.env },
        stdio: 'pipe',
        shell: false
      });

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | undefined;

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });

      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        reject(error);
      });

      child.on('close', (exitCode) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        const result = {
          exitCode: exitCode ?? -1,
          stdout,
          stderr
        };

        if (result.exitCode !== 0) {
          reject(new CommandExecutionError(execution, result));
          return;
        }

        resolve(result);
      });

      if (typeof execution.stdin === 'string') {
        child.stdin.write(execution.stdin);
      }

      child.stdin.end();

      if (execution.timeoutMs) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          reject(
            new Error(`Command "${execution.command}" exceeded timeout of ${execution.timeoutMs}ms.`)
          );
        }, execution.timeoutMs);
      }
    });
  }
}
