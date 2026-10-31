#!/bin/bash
# Amazon Linux 2023: Docker + Compose, and the Postgres data volume mounted at /srv/pgdata.
set -euxo pipefail

# Cost backstop for throwaway environments: power off (→ terminate) after N minutes.
# Armed first, so it holds even if anything below fails.
if [ "${auto_shutdown_minutes}" -gt 0 ]; then
  shutdown -h "+${auto_shutdown_minutes}"
fi

dnf install -y docker
systemctl enable --now docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
  https://github.com/docker/compose/releases/download/v5.6.1/docker-compose-linux-aarch64
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# The data volume is attached after boot; wait for the second disk (NVMe names are not stable).
root_disk="/dev/$(lsblk -no PKNAME "$(findmnt -no SOURCE /)")"
data_disk=""
for _ in $(seq 1 60); do
  data_disk=$(lsblk -dpno NAME,TYPE | awk '$2 == "disk" {print $1}' | grep -v "^$${root_disk}$" | head -1 || true)
  [ -n "$data_disk" ] && break
  sleep 5
done
[ -n "$data_disk" ]
blkid "$data_disk" || mkfs -t xfs "$data_disk"
mkdir -p /srv/pgdata
uuid=$(blkid -s UUID -o value "$data_disk")
grep -q "$uuid" /etc/fstab || echo "UUID=$uuid /srv/pgdata xfs defaults,nofail 0 2" >> /etc/fstab
mount -a
mkdir -p /opt/scuby
touch /opt/scuby/.bootstrapped
