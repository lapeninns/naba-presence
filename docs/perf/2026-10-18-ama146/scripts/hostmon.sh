#!/bin/sh
# usage: hostmon.sh <outfile> ; samples until killed
while :; do
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  la=$(sysctl -n vm.loadavg | tr -d '{}')
  cpu=$(top -l 2 -n 0 -s 1 | grep "CPU usage" | tail -1 | sed 's/CPU usage: //')
  mem=$(memory_pressure | tail -1 | sed 's/.*: //')
  echo "$ts load=[$la] cpu=[$cpu] memfree=$mem" >> "$1"
  sleep 4
done
