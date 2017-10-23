#!/bin/bash

set -e

function usage() {
    cat << EOF
description: Remove machine-controller and all service containers from this machine
usage: sudo ./cluster-leave.sh

options:
-h, --help                                     show brief help
EOF
    exit 0
}

services=(
    "machine-controller-"
    "pitcher_"
    "frontend_"
    "frontend-balancer_"
    "playout-management_"
    "playout-controller_"
    "log_"
    "login_"
    "log-viewer_"
    "influxdb_"
    "metric-viewer_"
    "cluster-monitor_"
    "etcd_"
    "video-source_"
    "zookeeper_"
    "kafka_"
    "ad-impression-router_"
    "ad-session-router_"
    "ad-vast-requester_"
    "ad-vast-reporter_"
    "ad-deduplicator_"
    "ad-playlist_"
    "scaling_"
    "schema-registry_"
)

while [ $# -gt 0 ] 
do
    case "$1" in
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option $1"
            exit 1
            ;;
    esac
done

for serviceName in "${services[@]}"
do
	docker ps | grep ${serviceName} | awk '{FS=" "; print $1}' | xargs -r docker stop
done

for serviceName in "${services[@]}"
do
	docker ps -a | grep ${serviceName} | awk '{FS=" "; print $1}' | xargs -r docker rm -v
done

for serviceName in "${services[@]}"
do
	docker volume ls | grep ${serviceName} | awk '{FS=" "; print $2}' | xargs -r docker volume rm
done

rm -rf /etc/sye
