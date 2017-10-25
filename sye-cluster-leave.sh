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

if ! docker ps -a -q > /dev/null
then
    docker stop $(docker ps -a -q)
    docker rm -v $(docker ps -a -q)
fi

if ! docker volume ls -q -f dangling=true > /dev/null
then
    docker volume rm $(docker volume ls -q -f dangling=true)
fi

rm -rf /etc/sye
