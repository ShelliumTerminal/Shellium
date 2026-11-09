# Linux test bed for Shellium's app password (Electron safeStorage on GNOME Keyring / libsecret).
# Ubuntu 24.04 + Xvfb + D-Bus + gnome-keyring; the app itself (dist/, dist-electron/) is mounted
# from the host at run time, only node_modules (with the Linux Electron binary) is baked in.
# Build from the repo root:  docker build -f test/linux/Dockerfile -t shellium-linux-test .
# Run:                       see test/linux/README.md
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg procps socat sudo \
      xvfb xauth dbus dbus-x11 gnome-keyring libsecret-1-0 libsecret-tools \
      libgtk-3-0t64 libnss3 libgbm1 libasound2t64 libxss1 libxtst6 libatk-bridge2.0-0t64 libdrm2 \
      libxkbcommon0 libxrandr2 libxdamage1 libxcomposite1 libxfixes3 libcups2t64 libpango-1.0-0 \
      libcairo2 fonts-dejavu-core \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g pnpm@10 \
 && rm -rf /var/lib/apt/lists/*

# Two desktop users: "alice" runs Shellium; "bob" receives a copy of alice's data (must not open it).
RUN useradd -m -s /bin/bash alice && useradd -m -s /bin/bash bob

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile && chmod -R a+rX /app
COPY test/linux/start.sh test/linux/stop.sh test/linux/sshd.cjs /app/test/linux/
RUN chmod +x /app/test/linux/start.sh /app/test/linux/stop.sh

EXPOSE 9342 9230
CMD ["sleep", "infinity"]
