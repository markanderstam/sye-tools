#!/usr/bin/env bash

set -o errexit -o pipefail

declare CONFDIR=
declare FILE=

function errcho() {
    1>&2 echo $@
}

function _main {
    _setGlobalVariablesDefaults
    _setGlobalVariablesFromArgs $@

    extractConfigurationFile "${FILE}" "${CONFDIR}"

    echo "*** --------------------------------------------- ***"
    echo "*** Waiting for certificate rotation to complete: ***"
    echo "*** --------------------------------------------- ***"
    until [ -n "$ROTATED" ]; do
        waitForCertsReloaded
        sleep 1
    done
}

function _setGlobalVariablesDefaults() {
    CONFDIR=${CONFDIR:-"/etc/sye"}
    # Set default values
}

function _setGlobalVariablesFromArgs() {
    while [ $# -gt 0 ]; do
        case "$1" in
            -h|--help)
                _usage
                ;;
            -f|--file)
                validateFlag --file $2
                FILE=$2
                shift
                ;;
            *)
                errcho "Unknown option $1"
                exit 1
                ;;
        esac
        shift
    done
}

function _usage() {
    cat << EOF
description: Update certificates from SYE configuration file
usage: sudo ./sye-cluster-install-certs.sh --file <config-file>

options:
-f, --file <filename>                          configuration filename, default ./sye-environment.tar.gz
-h, --help                                     show brief help
EOF
    exit 0
}

function validateFlag() {
    if [ -z $2 ]; then
        echo 'No value provided for '$1
        exit 1
    fi
}

function extractConfigurationFile() {
    local file=$1
    local confDir=$2
    if [[ ! -r ${file} ]]; then
        errcho "Configuration file ${file} missing, exiting"
        exit 1
    fi
    rm -rf /tmp/keys
    tar -xzf ${file} -C /tmp -o keys
    if diff -r /tmp/keys ${confDir}/keys > /dev/null; then
        rm -r /tmp/keys
        errcho "The certificates are identical to those already installed, exiting"
        exit 1
    fi
    rm -r /tmp/keys
    tar -xzf ${file} -C ${confDir} -o keys
}

function waitForCertsReloaded() {
    local machineControllerName=$(docker ps --filter 'name=machine-controller-' --format '{{.Names}}')
    if ! [[ ${machineControllerName} ]]; then
        errcho "Cannot find the machine controller container"
        return
    fi
    while read logLine; do
        echo $logLine
        if [[ $logLine == *"CA Certificate Update Complete"* ]]; then
            ROTATED=true
            break
        fi
    done < <(docker logs ${machineControllerName} -f --since 5s)
}

if [ "$0" == "$BASH_SOURCE" ]; then
    _main $@
fi
