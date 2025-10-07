#!/bin/bash
set -euo pipefail  # Exit on error, undefined vars, and pipeline failures

# Set default policies to ACCEPT (allow all traffic)
iptables -P INPUT ACCEPT
iptables -P FORWARD ACCEPT
iptables -P OUTPUT ACCEPT

# Flush existing rules
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X

echo "Network firewall disabled - all connections allowed"