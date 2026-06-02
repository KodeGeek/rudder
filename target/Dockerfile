# ── Rudder Ansible target ───────────────────────────────────────
# A small Linux + sshd + python3 host that real Ansible runs land on.
# The authorized public key is pulled from Vault at startup (no key in git).
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server sudo curl jq ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -s /bin/bash rudder \
    && echo "rudder ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/rudder \
    && chmod 0440 /etc/sudoers.d/rudder \
    && ln -sf /usr/local/bin/python3 /usr/bin/python3

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
HEALTHCHECK --interval=20s --timeout=4s --start-period=15s --retries=5 \
  CMD bash -c ': >/dev/tcp/127.0.0.1/22' || exit 1

ENTRYPOINT ["/entrypoint.sh"]
