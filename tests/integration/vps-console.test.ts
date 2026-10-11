import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const common = resolve(import.meta.dir, "../../scripts/vps/common.sh");
const daemons = ["sshd", "sshd-session", "tailscaled"];

describe.skipIf(process.platform !== "linux")("VPS console-only guard", () => {
  let directory: string;
  let bash: string;
  beforeAll(() => {
    const executable = Bun.which("bash");
    if (!executable) throw new Error("Bash is required for VPS guard tests");
    bash = executable;
    directory = mkdtempSync(join(tmpdir(), "derp-console-test-"));
    for (const name of [...daemons, "sudo"])
      symlinkSync(bash, join(directory, name));
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  test.each(daemons)(
    "rejects %s ancestry through sudo with SSH environment removed",
    (daemon) => {
      // Bash symlinks supply real Linux comm names, not a mocked /proc tree.
      // Keep both ancestors alive instead of allowing a last-command exec.
      const forward = '"$@"; status=$?; exit "$status"';
      const result = Bun.spawnSync(
        [
          join(directory, daemon),
          "-c",
          forward,
          "remote",
          join(directory, "sudo"),
          "-c",
          forward,
          "sudo",
          bash,
          "-c",
          'source "$1"; require_console',
          "guard",
          common,
        ],
        {
          env: { PATH: process.env.PATH, SUDO_USER: "derp-admin" },
          stdout: "pipe",
          stderr: "pipe",
          timeout: 5_000,
        },
      );
      expect(result.exitCode).toBe(1);
    },
  );
});
