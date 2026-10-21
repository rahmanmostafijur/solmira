import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';

const READY_TIMEOUT_MS = 60_000;
const LOG_LINES = 200;

/** One of the real services, running as its own OS process, so it can be killed like a crashed one. */
export class ServiceProcess {
  private child: ChildProcess | undefined;
  private readonly log: string[] = [];

  constructor(
    readonly name: string,
    private readonly cwd: string,
    private readonly env: Record<string, string>,
    private readonly readyUrl: string,
  ) {}

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get isRunning(): boolean {
    return this.child !== undefined && this.child.exitCode === null && !this.child.killed;
  }

  /** The last lines the service wrote, for a failure message. */
  get recentLog(): string {
    return this.log.join('\n');
  }

  async start(extraEnv: Record<string, string> = {}): Promise<void> {
    const child = spawn(process.execPath, ['dist/main.js'], {
      cwd: this.cwd,
      env: { ...process.env, ...this.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (chunk: Buffer) => {
      this.log.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      if (this.log.length > LOG_LINES) this.log.splice(0, this.log.length - LOG_LINES);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    this.child = child;
    await this.waitReady();
  }

  /** A crash: the process is killed without any chance to finish what it was doing. */
  async crash(): Promise<void> {
    await this.end('SIGKILL');
  }

  /** A graceful shutdown, as a deploy would do it. */
  async stop(): Promise<void> {
    await this.end('SIGTERM');
  }

  private async end(signal: NodeJS.Signals): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill(signal);
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15_000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    this.child = undefined;
  }

  private async waitReady(): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.child?.exitCode !== null && this.child?.exitCode !== undefined) {
        throw new Error(`${this.name} exited with ${this.child.exitCode}:\n${this.recentLog}`);
      }
      try {
        const response = await fetch(this.readyUrl);
        if (response.ok) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`${this.name} was not ready in time:\n${this.recentLog}`);
  }
}

/** Total CPU time a process has used, in seconds; null when it cannot be read on this platform. */
export function cpuSeconds(pid: number): number | null {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).TotalProcessorTime.TotalSeconds`],
      { encoding: 'utf8' },
    );
    const value = Number(result.stdout.trim().replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
    return (Number(fields[11]) + Number(fields[12])) / 100;
  } catch {
    return null;
  }
}
