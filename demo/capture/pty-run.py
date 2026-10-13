"""Runs a program in a pseudo-terminal (gnokey reads its password from the terminal).

stdout: one JSON object per chunk of the program's output, {"text": ...}, then {"exit": code}.
stdin: every line received is typed into the program's terminal.
"""
import json
import os
import pty
import select
import sys


def main() -> int:
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(sys.argv[1], sys.argv[1:])
    out = sys.stdout
    stdin = sys.stdin.fileno()
    while True:
        ready, _, _ = select.select([fd] + ([stdin] if stdin >= 0 else []), [], [])
        if fd in ready:
            try:
                data = os.read(fd, 4096)
            except OSError:
                break
            if not data:
                break
            out.write(json.dumps({"text": data.decode("utf-8", "replace")}) + "\n")
            out.flush()
        if stdin in ready:
            line = os.read(stdin, 4096)
            if not line:
                stdin = -1  # closed: stop watching it
                continue
            os.write(fd, line)
    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
    out.write(json.dumps({"exit": code}) + "\n")
    out.flush()
    return code


if __name__ == "__main__":
    sys.exit(main())
